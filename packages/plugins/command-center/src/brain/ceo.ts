/**
 * The CEO orchestrator — the brain that turns one operator message into governed,
 * verified, reported work.
 *
 * Built on the run reducer (run.ts), so the same logic serves two callers:
 *   - handleObjective(): drains the run to completion synchronously (harness/tests).
 *   - startRun() + tick(): the Paperclip host dispatches on /chat, then advances
 *     one tick per /chat/poll with the RunState persisted to ctx.state — no blocked
 *     request while workers grind.
 *
 * Loop per the reducer: plan (decompose) -> dispatch ready tasks through the hands
 * (create + explicit wake) with each member's stack injected -> collect results ->
 * run the QA verify gate on done+needsQA tasks -> report. Everything is a port, so
 * it runs against the host or the in-memory harness unchanged.
 */
import type { Clock, EventSink, Hands, IdGen, LLM, Logger, MemoryStore } from "../core/ports";
import type { CeoAction, CeoReply, Org, RoleId, RunState } from "../core/types";
import type { StackRegistry } from "../stacks/role-stacks";
import { ceoOf } from "../org/org";
import { planObjective } from "./planner";
import { DEFAULT_AUTONOMY, type AutonomyConfig } from "./autonomy";
import { DEFAULT_MONITOR, type MonitorOptions } from "./monitor";
import { synthesizeReport } from "./reporter";
import { appendTurn, compactIfNeeded, type MemoryPolicy } from "../memory/memory-store";
import { advanceRun, newRunState, runMaps, type RunDeps } from "./run";
import { estimateRunSpend } from "./cost";
import { classifyIntent, conversationalReply, type Intent } from "./intent";
import { renderContext } from "../memory/memory-store";

export interface CeoDeps {
  org: Org;
  registry: StackRegistry;
  hands: Hands;
  memory: MemoryStore;
  clock: Clock;
  newId: IdGen;
  llm?: LLM;
  monitor?: MonitorOptions;
  autonomy?: AutonomyConfig;
  events?: EventSink;
  logger?: Logger;
}

const MAX_TICKS = 200; // safety cap for the synchronous drain

export class CEO {
  constructor(private readonly deps: CeoDeps) {}

  /**
   * Roles the CEO can route to. Dedicated members always count; in solo mode the
   * CEO can also self-staff any role the registry knows — so a single connected CC
   * can be decomposed into engineer/qa/researcher/marketer work.
   */
  availableRoles(): RoleId[] {
    const connected = this.deps.org.members.filter((m) => m.role !== "ceo").map((m) => m.role);
    if (this.deps.org.soloFallback === false) return connected;
    const all = this.deps.registry.list().map((s) => s.role).filter((r) => r !== "ceo");
    return Array.from(new Set([...connected, ...all]));
  }

  /** Is this message real work to dispatch, or just conversation? */
  async classify(text: string): Promise<Intent> {
    return classifyIntent(text, this.deps.llm);
  }

  /** A conversational reply in the CEO's (OperatorOS) voice — no dispatch. */
  async chat(text: string, conversationId?: string): Promise<string> {
    const ceoStack = this.deps.registry.get(ceoOf(this.deps.org).stackId);
    let contextSummary: string | undefined;
    if (conversationId) {
      const mem = await this.deps.memory.load(conversationId);
      contextSummary = mem.turns.length || mem.summary ? renderContext(mem) : undefined;
    }
    return conversationalReply(text, { llm: this.deps.llm, persona: ceoStack?.persona, contextSummary });
  }

  private runDeps(): RunDeps {
    const ceoStack = this.deps.registry.get(ceoOf(this.deps.org).stackId);
    return {
      org: this.deps.org,
      registry: this.deps.registry,
      hands: this.deps.hands,
      newId: this.deps.newId,
      monitor: this.deps.monitor ?? DEFAULT_MONITOR,
      autonomy: this.deps.autonomy ?? DEFAULT_AUTONOMY,
      events: this.deps.events,
      posture: ceoStack?.autonomy ?? "act-then-report",
    };
  }

  /** Plan an objective and produce the initial (undispatched) run state. */
  async startRun(text: string, conversationId: string, requestedBy = "operator"): Promise<RunState> {
    this.deps.events?.emit({ type: "ceo.thinking", text: "Decomposing the objective…" });
    const objective = { id: this.deps.newId("obj"), text, conversationId, requestedBy };
    const plan = await planObjective(objective, { availableRoles: this.availableRoles() }, this.deps.newId, this.deps.llm);
    this.deps.events?.emit({ type: "ceo.plan", summary: plan.summary, taskCount: plan.tasks.length });
    this.deps.logger?.info("ceo.plan", { tasks: plan.tasks.length });
    return newRunState(conversationId, text, plan);
  }

  /** Advance an in-flight run by one tick (the host calls this per poll). */
  async tick(state: RunState): Promise<{ changed: boolean; done: boolean }> {
    return advanceRun(state, this.runDeps());
  }

  /** Render the current report for a run state (interim or final). */
  report(state: RunState): string {
    const { results, verdicts, asks } = runMaps(state);
    return synthesizeReport({ plan: state.plan, results, verdicts, asks });
  }

  /**
   * Full synchronous loop: plan -> drain the run -> report -> persist memory.
   * The contract the harness and tests rely on.
   */
  async handleObjective(text: string, conversationId: string, requestedBy = "operator"): Promise<CeoReply> {
    const { memory, clock, events } = this.deps;
    const ceoStack = this.deps.registry.get(ceoOf(this.deps.org).stackId);
    const memPolicy: MemoryPolicy = ceoStack?.memory ?? { retainTurns: 24, summarizeAfterTurns: 40 };
    const monitor = this.deps.monitor ?? DEFAULT_MONITOR;

    let mem = await memory.load(conversationId);
    mem = appendTurn(mem, "user", text, clock.iso());

    const state = await this.startRun(text, conversationId, requestedBy);
    for (let i = 0; i < MAX_TICKS; i++) {
      const { done } = await this.tick(state);
      if (done) break;
      await monitor.sleep();
    }

    const report = this.report(state);
    events?.emit({ type: "ceo.report", text: report });

    mem = appendTurn(mem, "ceo", report, clock.iso());
    mem = compactIfNeeded(mem, memPolicy);
    await memory.save(mem);

    const spend = estimateRunSpend(state, this.deps.org, this.deps.registry);
    return { conversationId, text: report, plan: state.plan, actions: this.actionsFor(state, report), awaitingHuman: state.awaitingHuman, spend };
  }

  private actionsFor(state: RunState, report: string): CeoAction[] {
    const byId = new Map(state.plan.tasks.map((t) => [t.id, t]));
    const actions: CeoAction[] = [];
    for (const task of state.plan.tasks) {
      const issueId = state.dispatched[task.id];
      const result = state.results[task.id];
      if (issueId && result) {
        actions.push({
          kind: "dispatch",
          task,
          dispatch: { taskId: task.id, issueId, assigneeAgentId: "", role: task.role, stackId: "", wakeupQueued: true },
        });
      }
      const verdict = state.verdicts[task.id];
      if (verdict) actions.push({ kind: "qa", verdict });
    }
    for (const g of state.gated) {
      const task = byId.get(g.taskId);
      if (task) actions.push({ kind: "ask", question: `Approve "${task.title}"?`, reason: g.reason });
    }
    actions.push({ kind: "report", text: report });
    return actions;
  }
}
