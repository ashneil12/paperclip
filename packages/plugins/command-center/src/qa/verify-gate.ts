/**
 * V2 — the verify gate. After a worker delivers (and the task was needsQA), the
 * CEO does NOT declare done. It spawns a QA task for the QA member, and only
 * accepts the work once QA returns a PASS verdict. A FAIL routes to rework
 * instead of silently passing — the enforced ground-truth gate.
 *
 * The QA member runs two lanes (see the `qa-verify-gate` skill): a REQUIRED
 * deterministic gate (Playwright + @clerk/testing + toHaveScreenshot) whose
 * PASS/FAIL is authoritative, and an ADVISORY Midscene lane that is reported but
 * never blocks. Only the deterministic gate decides `passed`.
 *
 * Split into spawn + collect so the reducer can drive it one tick at a time
 * (non-blocking host); runVerifyGate keeps the synchronous convenience for tests.
 */
import type { Actor, Hands, HandsComment, IdGen } from "../core/ports";
import type { Org, QAVerdict, Task, TaskRunResult } from "../core/types";
import type { StackRegistry } from "../stacks/role-stacks";
import { resolveAdapterOverrides } from "../stacks/stack-injector";
import { memberForRole } from "../org/org";
import { awaitTaskResult, readTerminal, type MonitorOptions } from "../brain/monitor";

export interface VerifyDeps {
  hands: Hands;
  registry: StackRegistry;
  org: Org;
  newId: IdGen;
  ceoAgentId: string;
  monitor: MonitorOptions;
}

/** Spawn the QA task (create + explicit wake). Returns a skip verdict if no QA member. */
export async function spawnQa(
  task: Task,
  work: TaskRunResult,
  deps: VerifyDeps,
): Promise<{ qaIssueId: string } | { verdict: QAVerdict }> {
  const qa = memberForRole(deps.org, "qa");
  if (!qa) {
    return {
      verdict: {
        taskId: task.id,
        qaIssueId: "",
        passed: true,
        findings: ["QA gate skipped: no QA member connected. Connect a QA agent to enforce verification."],
      },
    };
  }
  const stack = deps.registry.get(qa.stackId);
  const overrides = stack ? resolveAdapterOverrides(stack) : undefined;
  const actor: Actor = { actorAgentId: deps.ceoAgentId };

  const qaIssue = await deps.hands.createTask(
    {
      title: `QA: ${task.title}`,
      description: qaBrief(task, work),
      assigneeAgentId: qa.agentId,
      goalId: deps.org.defaultGoalId,
      blockedByIssueIds: [work.issueId],
      priority: "high",
      adapterOverrides: overrides,
      billingCode: `command-center:qa:${task.id}`,
      originKind: "plugin:command-center:qa",
      originId: `qa:${task.id}`,
    },
    actor,
  );
  await deps.hands.wakeTask(qaIssue.id, { reason: "command-center:qa", idempotencyKey: `qa:${task.id}`, actorAgentId: deps.ceoAgentId });
  return { qaIssueId: qaIssue.id };
}

/** Poll the QA issue once; return a verdict if terminal, else null. */
export async function collectQaVerdict(taskId: string, qaIssueId: string, hands: Hands): Promise<QAVerdict | null> {
  const issue = await hands.getTask(qaIssueId);
  if (!issue || !readTerminal(issue.status)) return null;
  const comments = await hands.listComments(qaIssueId);
  return parseVerdict(taskId, qaIssueId, issue.status, comments);
}

/** Synchronous convenience: spawn, wait, collect. Used by the sync path + tests. */
export async function runVerifyGate(task: Task, work: TaskRunResult, deps: VerifyDeps): Promise<QAVerdict> {
  const spawned = await spawnQa(task, work, deps);
  if ("verdict" in spawned) return spawned.verdict;
  await awaitTaskResult(deps.hands, task.id, spawned.qaIssueId, deps.monitor);
  const verdict = await collectQaVerdict(task.id, spawned.qaIssueId, deps.hands);
  return verdict ?? { taskId: task.id, qaIssueId: spawned.qaIssueId, passed: false, findings: ["QA did not return a verdict in time."] };
}

function qaBrief(task: Task, work: TaskRunResult): string {
  return [
    `Verify the deliverable for: ${task.title}`,
    "",
    "You are the enforced ground-truth gate. Follow the `qa-verify-gate` skill exactly.",
    "",
    "## Acceptance criteria (prove EACH with an executed assertion)",
    task.acceptanceCriteria,
    "",
    "## What the worker reported",
    work.resultSummary,
    "",
    "## How to verify",
    "1. REQUIRED gate (authoritative — this decides PASS/FAIL): run deterministic Playwright against the real preview deploy, authenticate via Clerk's @clerk/testing tokens, and use toHaveScreenshot for visual regression. Map every acceptance criterion to an executed assertion.",
    "2. ADVISORY lane (never blocks): optionally run Midscene natural-language assertions on the self-hosted vision model for fuzzy checks. Report findings; they never change the gate result.",
    "",
    "## Verdict — post exactly ONE comment in this format",
    "- First line MUST be `VERDICT: PASS` or `VERDICT: FAIL` (the deterministic gate result).",
    "- Then one gate finding per line: which criterion passed/failed and how it was proven.",
    "- Then any advisory notes as `ADVISORY: <note>` lines (non-blocking; from the Midscene lane).",
    "Default to FAIL if any required criterion is unproven — a criterion you did not actually execute is a failed criterion.",
  ].join("\n");
}

/**
 * Parse the QA member's verdict comment. Two lanes:
 *  - `VERDICT: PASS|FAIL` (first line) is the AUTHORITATIVE deterministic-gate result.
 *  - `ADVISORY: <note>` lines are the non-blocking Midscene lane — captured, never gates.
 * Anything else after the verdict line is a gate finding.
 */
export function parseVerdict(taskId: string, qaIssueId: string, status: string, comments: HandsComment[]): QAVerdict {
  const verdictComment = [...comments].reverse().find((c) => /VERDICT:\s*(PASS|FAIL)/i.test(c.body));
  if (!verdictComment || status !== "done") {
    return { taskId, qaIssueId, passed: false, findings: ["QA did not return a clear PASS verdict."] };
  }
  const passed = /VERDICT:\s*PASS/i.test(verdictComment.body);
  const lines = verdictComment.body
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
  const advisory = lines
    .filter((l) => /^ADVISORY:/i.test(l))
    .map((l) => l.replace(/^ADVISORY:\s*/i, "").trim())
    .filter(Boolean);
  const findings = lines
    .filter((l) => !/^ADVISORY:/i.test(l))
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const verdict: QAVerdict = { taskId, qaIssueId, passed, findings };
  if (advisory.length) verdict.advisory = advisory;
  return verdict;
}
