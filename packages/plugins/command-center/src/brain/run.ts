/**
 * The run reducer — one tick of the CEO loop over a serializable RunState.
 *
 * This is what lets the loop be both synchronous (the harness/tests drain it in a
 * while-loop) AND resumable (the Paperclip host persists RunState to ctx.state,
 * advances one tick per /chat/poll, and returns without blocking). A tick:
 *   1. dispatch every ready task (deps done) — gating destructive ones,
 *   2. collect terminal results for dispatched tasks,
 *   3. drive the QA verify gate for done+needsQA tasks (auto-reworking a FAIL back
 *      to the role with the QA findings baked in, up to maxRework attempts),
 *   4. mark tasks blocked when an upstream dep failed,
 * then report whether the whole run is finished.
 */
import type { EventSink, Hands, IdGen } from "../core/ports";
import type { AutonomyPosture, Org, Plan, QAVerdict, RunState, Task, TaskRunResult } from "../core/types";
import type { StackRegistry } from "../stacks/role-stacks";
import type { AutonomyConfig } from "./autonomy";
import type { MonitorOptions } from "./monitor";
import { classifyTaskDecision, requiresHuman, DEFAULT_AUTONOMY } from "./autonomy";
import { dispatchTask } from "./router";
import { spawnQa, collectQaVerdict } from "../qa/verify-gate";
import { ceoOf } from "../org/org";
import { readTerminal } from "./monitor";

export interface RunDeps {
  org: Org;
  registry: StackRegistry;
  hands: Hands;
  newId: IdGen;
  monitor: MonitorOptions;
  autonomy?: AutonomyConfig;
  events?: EventSink;
  posture?: AutonomyPosture;
  /** Max QA-fail auto-rework attempts before a task settles as failed. Default 2. */
  maxRework?: number;
}

export function newRunState(conversationId: string, objectiveText: string, plan: Plan): RunState {
  return {
    conversationId,
    objectiveText,
    plan,
    dispatched: {},
    results: {},
    verdicts: {},
    qaIssues: {},
    reworks: {},
    reworkNotes: {},
    gated: [],
    awaitingHuman: false,
    done: false,
  };
}

/** Advance the run by one tick. Returns whether anything changed + whether it's done. */
export async function advanceRun(state: RunState, deps: RunDeps): Promise<{ changed: boolean; done: boolean }> {
  const { org, registry, hands, newId, events } = deps;
  const autonomy = deps.autonomy ?? DEFAULT_AUTONOMY;
  const posture = deps.posture ?? "act-then-report";
  const maxRework = deps.maxRework ?? 2;
  const ceo = ceoOf(org);
  let changed = false;

  // 1. Dispatch every ready task.
  for (const task of state.plan.tasks) {
    if (taskSettled(state, task)) continue;
    if (state.dispatched[task.id] || isGated(state, task.id)) continue;

    const depState = depReadiness(state, task);
    if (depState === "blocked") {
      state.results[task.id] = { taskId: task.id, issueId: "", status: "blocked", resultSummary: "Upstream dependency failed." };
      changed = true;
      continue;
    }
    if (depState === "waiting") continue;

    const decision = classifyTaskDecision(task);
    const need = requiresHuman(decision, posture, autonomy);
    if (need) {
      const issue = await hands.createTask(
        { title: task.title, description: `${task.description}\n\nPaused for operator decision: ${need}`, assigneeAgentId: ceo.agentId, goalId: org.defaultGoalId, priority: "high", originKind: "plugin:command-center:gate", originId: `gate:${task.id}` },
        { actorAgentId: ceo.agentId },
      );
      await hands.askHuman(issue.id, `Approve "${task.title}"? Reason it's gated: ${need}`, { actorAgentId: ceo.agentId });
      state.gated.push({ taskId: task.id, reason: need });
      state.awaitingHuman = true;
      events?.emit({ type: "ceo.awaiting_human", question: task.title });
      changed = true;
      continue;
    }

    const depIssueIds = task.dependsOn.map((d) => state.dispatched[d]).filter((x): x is string => Boolean(x));
    // On a rework pass, the QA findings ride along in the brief so the worker fixes them.
    const reworkNote = state.reworkNotes?.[task.id];
    const toDispatch = reworkNote ? { ...task, description: `${task.description}\n\n${reworkNote}` } : task;
    const dispatch = await dispatchTask(toDispatch, depIssueIds, { hands, registry, org, newId, ceoAgentId: ceo.agentId });
    state.dispatched[task.id] = dispatch.issueId;
    events?.emit({ type: "task.dispatched", taskId: task.id, issueId: dispatch.issueId, role: dispatch.role });
    changed = true;
  }

  // 2. Collect terminal results for dispatched tasks.
  for (const task of state.plan.tasks) {
    const issueId = state.dispatched[task.id];
    if (!issueId || state.results[task.id]) continue;
    const issue = await hands.getTask(issueId);
    if (!issue) continue;
    const terminal = readTerminal(issue.status);
    if (!terminal) continue;
    const comments = await hands.listComments(issueId);
    const lastAgent = [...comments].reverse().find((c) => c.authorKind === "agent" || c.authorAgentId);
    const result: TaskRunResult = {
      taskId: task.id,
      issueId,
      status: terminal === "done" ? "done" : "failed",
      resultSummary: lastAgent?.body?.trim() || "(no result comment)",
    };
    state.results[task.id] = result;
    events?.emit({ type: "task.result", taskId: task.id, status: result.status, summary: result.resultSummary });
    changed = true;
  }

  // 3. QA verify gate for done + needsQA tasks — tick-based (spawn, then collect).
  for (const task of state.plan.tasks) {
    const result = state.results[task.id];
    if (!result || result.status !== "done" || !task.needsQA || state.verdicts[task.id]) continue;
    const verifyDeps = { hands, registry, org, newId, ceoAgentId: ceo.agentId, monitor: deps.monitor };
    if (!state.qaIssues[task.id]) {
      const spawned = await spawnQa(task, result, verifyDeps);
      if ("verdict" in spawned) {
        state.verdicts[task.id] = spawned.verdict;
        events?.emit({ type: "qa.verdict", taskId: task.id, passed: spawned.verdict.passed });
      } else {
        state.qaIssues[task.id] = spawned.qaIssueId;
      }
      changed = true;
    } else {
      const verdict = await collectQaVerdict(task.id, state.qaIssues[task.id]!, hands);
      if (verdict) {
        const attempts = state.reworks?.[task.id] ?? 0;
        if (!verdict.passed && attempts < maxRework) {
          // Self-healing gate: a QA FAIL re-dispatches the task to its role with the
          // findings baked into the brief, then re-verifies — instead of stopping at "needs rework".
          state.reworks = state.reworks ?? {};
          state.reworkNotes = state.reworkNotes ?? {};
          const next = attempts + 1;
          state.reworks[task.id] = next;
          state.reworkNotes[task.id] = reworkBrief(next, maxRework, verdict.findings);
          delete state.dispatched[task.id];
          delete state.results[task.id];
          delete state.qaIssues[task.id];
          events?.emit({ type: "task.progress", taskId: task.id, text: `QA FAIL → re-dispatching to ${task.role} with findings (attempt ${next}/${maxRework}).` });
        } else {
          // Passed, or out of rework attempts — settle the verdict (authoritative).
          state.verdicts[task.id] = verdict;
          events?.emit({ type: "qa.verdict", taskId: task.id, passed: verdict.passed });
        }
        changed = true;
      }
    }
  }

  state.done = state.plan.tasks.every((t) => taskSettled(state, t));
  return { changed, done: state.done };
}

// --- helpers --------------------------------------------------------------
/** The rework brief appended to a re-dispatched task after a QA FAIL. */
function reworkBrief(attempt: number, max: number, findings: string[]): string {
  const list = findings.length
    ? findings.map((f) => `- ${f}`).join("\n")
    : "- (QA enumerated no specific findings — re-verify every acceptance criterion.)";
  return [
    `## Rework (attempt ${attempt} of ${max})`,
    "The QA gate FAILED the previous attempt. Fix each finding below, then it will be re-verified. Do not expand scope.",
    "",
    "### QA findings to address",
    list,
  ].join("\n");
}

function isGated(state: RunState, taskId: string): boolean {
  return state.gated.some((g) => g.taskId === taskId);
}

/** A task is settled when it's gated, blocked/failed, or done-and-(QA-clear). */
export function taskSettled(state: RunState, task: Task): boolean {
  if (isGated(state, task.id)) return true;
  const r = state.results[task.id];
  if (!r) return false;
  if (r.status !== "done") return true; // failed/blocked are terminal
  if (!task.needsQA) return true;
  return Boolean(state.verdicts[task.id]);
}

type DepReadiness = "ready" | "waiting" | "blocked";
function depReadiness(state: RunState, task: Task): DepReadiness {
  for (const dep of task.dependsOn) {
    const r = state.results[dep];
    if (!r) return "waiting";
    if (r.status !== "done") return "blocked";
  }
  return "ready";
}

/** Materialize the maps the reporter expects. */
export function runMaps(state: RunState): {
  results: Map<string, TaskRunResult>;
  verdicts: Map<string, QAVerdict>;
  asks: Array<{ task: Task; reason: string }>;
} {
  const byId = new Map(state.plan.tasks.map((t) => [t.id, t]));
  return {
    results: new Map(Object.entries(state.results)),
    verdicts: new Map(Object.entries(state.verdicts)),
    asks: state.gated.map((g) => ({ task: byId.get(g.taskId)!, reason: g.reason })).filter((a) => a.task),
  };
}
