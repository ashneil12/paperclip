/**
 * The Paperclip plugin worker. Wires the pure CEO engine to the real host.
 *
 * Interactive (talk to your CEO):
 *   - POST /chat  : record the message, plan, dispatch ready tasks (create + wake)
 *                   with each member's stack injected, persist RunState, return the
 *                   plan + interim report. Non-blocking.
 *   - GET  /poll  : advance the run one tick (collect results, drive QA), persist,
 *                   return the latest report. On done, write the CEO turn to memory.
 *   - GET  /roster: the connected org (which agent fills which role + stack).
 *
 * Autonomous (the CEO keeps working while you sleep):
 *   - POST /enqueue  : add a standing objective to the backlog.
 *   - GET  /backlog  : pending + processed counts.
 *   - POST /tick     : process ONE backlog objective end-to-end; append to the
 *                      briefing. (A Paperclip routine / cron calls this on a schedule,
 *                      or the `drain-backlog` action drains the whole queue.)
 *   - GET  /briefing : the "while you were away" digest (add ?clear=1 to reset).
 *
 * Everything goes through PaperclipHands -> ctx.issues (budgets, checkout, approvals,
 * audit). Solo mode is the default: connect ONE Claude Code as the CEO (or list it
 * once in the roster) and it self-staffs every other role with that same session.
 */
import { randomUUID } from "node:crypto";
import { definePlugin, runWorker, type PluginApiRequestInput, type PluginContext } from "../sdk";
import type { Clock, IdGen } from "../core/ports";
import type { Org, RoleId, RoleStack } from "../core/types";
import { StackRegistry } from "../stacks/role-stacks";
import { OrgBuilder } from "../org/org";
import { CEO } from "../brain/ceo";
import { PaperclipHands } from "./hands-paperclip";
import { PaperclipMemoryStore, RunStateStore, BacklogStore, BriefingStore } from "./state-store";
import { ClaudeCliLLM } from "./llm-claude";
import { appendTurn, compactIfNeeded, type MemoryPolicy } from "../memory/memory-store";
import { synthesizeBriefing, type BriefingEntry } from "../brain/briefing";

const clock: Clock = { now: () => Date.now(), iso: () => new Date().toISOString() };
const newId: IdGen = (p) => `${p}_${randomUUID().slice(0, 8)}`;

interface RosterEntry {
  role: RoleId;
  agentId: string;
  stackId?: string;
}
interface CcConfig {
  defaultGoalId?: string;
  roster?: RosterEntry[];
  /** Optional custom role stacks registered at runtime (different stacks per member). */
  stacks?: RoleStack[];
}

let context: PluginContext | null = null;

function buildOrg(registry: StackRegistry, companyId: string, cfg: CcConfig): Org {
  const roster = cfg.roster ?? [];
  if (roster.length === 0) {
    throw new Error("No roster configured. Connect an agent and add it to the plugin config roster as the 'ceo'.");
  }
  // If no explicit CEO, promote the first connected agent — so a single roster entry just works.
  const hasCeo = roster.some((e) => e.role === "ceo");
  const first = roster[0]!;
  const entries: RosterEntry[] = hasCeo ? roster : [{ role: "ceo", agentId: first.agentId, stackId: first.stackId }, ...roster.slice(1)];

  const builder = new OrgBuilder(registry, companyId, cfg.defaultGoalId); // solo on by default
  for (const e of entries) builder.connect({ role: e.role, agentId: e.agentId, stackId: e.stackId });
  return builder.build();
}

function makeCeo(ctx: PluginContext, companyId: string, cfg: CcConfig) {
  const registry = new StackRegistry();
  for (const s of cfg.stacks ?? []) registry.register(s); // custom stacks per member
  const org = buildOrg(registry, companyId, cfg);
  const ceoMember = org.members.find((m) => m.role === "ceo")!;
  const ceoStack = registry.get(ceoMember.stackId);
  const hands = new PaperclipHands(ctx.issues, companyId);
  const memory = new PaperclipMemoryStore(ctx.state, companyId);
  const runStore = new RunStateStore(ctx.state, companyId);
  const llm = new ClaudeCliLLM({ model: ceoStack?.model });
  const ceo = new CEO({ org, registry, hands, memory, clock, newId, llm, monitor: { maxPolls: 1, sleep: async () => {} } });
  const memPolicy: MemoryPolicy = ceoStack?.memory ?? { retainTurns: 24, summarizeAfterTurns: 40 };
  return { ceo, memory, runStore, memPolicy };
}

/** Process one backlog objective end-to-end and record a briefing entry. Returns null if empty. */
async function tickBacklog(ctx: PluginContext, companyId: string, cfg: CcConfig): Promise<{ objective: string; remaining: number } | null> {
  const backlog = new BacklogStore(ctx.state, companyId);
  const queue = await backlog.load();
  const next = queue[0];
  if (next === undefined) return null;
  await backlog.save(queue.slice(1));

  const { ceo } = makeCeo(ctx, companyId, cfg);
  const reply = await ceo.handleObjective(next, `backlog_${newId("c")}`, "operator-loop");
  const entry: BriefingEntry = { objective: next, reply, spend: reply.spend };
  await new BriefingStore(ctx.state, companyId).append(entry);
  return { objective: next, remaining: queue.length - 1 };
}

const plugin = definePlugin({
  async setup(ctx) {
    context = ctx;
    ctx.logger.info("command-center worker started");
    ctx.data.register("roster", async () => {
      const cfg = (await ctx.config.get()) as CcConfig;
      return { roster: cfg.roster ?? [] };
    });
    // Routine/cron target: drain the whole backlog overnight, then surface the briefing.
    ctx.actions.register("drain-backlog", async (params) => {
      const cfg = (await ctx.config.get()) as CcConfig;
      const companyId = String(params.companyId ?? "");
      if (!companyId) throw new Error("companyId is required");
      let processed = 0;
      for (let i = 0; i < 50; i++) {
        const r = await tickBacklog(ctx, companyId, cfg);
        if (!r) break;
        processed += 1;
      }
      const entries = await new BriefingStore(ctx.state, companyId).load();
      return { processed, briefing: synthesizeBriefing(entries) };
    });
  },

  async onApiRequest(input: PluginApiRequestInput) {
    const ctx = context;
    if (!ctx) return { status: 503, body: { error: "worker not ready" } };
    const cfg = (await ctx.config.get()) as CcConfig;
    const companyId = input.companyId;

    try {
      if (input.routeKey === "roster") {
        return { body: { roster: cfg.roster ?? [], soloMode: true } };
      }

      if (input.routeKey === "chat") {
        const body = (input.body ?? {}) as { message?: string; conversationId?: string };
        if (!body.message) return { status: 400, body: { error: "message is required" } };
        const conversationId = body.conversationId ?? newId("conv");
        const { ceo, memory, runStore } = makeCeo(ctx, companyId, cfg);

        let mem = await memory.load(conversationId);
        mem = appendTurn(mem, "user", body.message, clock.iso());
        await memory.save(mem);

        const run = await ceo.startRun(body.message, conversationId, input.actor.userId ?? "operator");
        const { done } = await ceo.tick(run);
        await runStore.save(run);
        return { status: 201, body: { conversationId, plan: run.plan, report: ceo.report(run), done, awaitingHuman: run.awaitingHuman } };
      }

      if (input.routeKey === "poll") {
        const conversationId = String(input.query.conversationId ?? "");
        if (!conversationId) return { status: 400, body: { error: "conversationId is required" } };
        const { ceo, memory, runStore, memPolicy } = makeCeo(ctx, companyId, cfg);
        const run = await runStore.load(conversationId);
        if (!run) return { status: 404, body: { error: "no active run for that conversation" } };

        const { done } = await ceo.tick(run);
        await runStore.save(run);
        const report = ceo.report(run);
        if (done) {
          let mem = await memory.load(conversationId);
          mem = appendTurn(mem, "ceo", report, clock.iso());
          mem = compactIfNeeded(mem, memPolicy);
          await memory.save(mem);
          await runStore.clear(conversationId);
        }
        return { body: { conversationId, report, done, awaitingHuman: run.awaitingHuman } };
      }

      if (input.routeKey === "enqueue") {
        const body = (input.body ?? {}) as { objective?: string };
        if (!body.objective) return { status: 400, body: { error: "objective is required" } };
        const backlog = new BacklogStore(ctx.state, companyId);
        const queue = await backlog.load();
        queue.push(body.objective);
        await backlog.save(queue);
        return { status: 201, body: { pending: queue.length } };
      }

      if (input.routeKey === "backlog") {
        const pending = (await new BacklogStore(ctx.state, companyId).load()).length;
        const processed = (await new BriefingStore(ctx.state, companyId).load()).length;
        return { body: { pending, processed } };
      }

      if (input.routeKey === "tick") {
        const r = await tickBacklog(ctx, companyId, cfg);
        if (!r) return { body: { processed: null, remaining: 0, message: "backlog empty" } };
        return { body: { processed: r.objective, remaining: r.remaining } };
      }

      if (input.routeKey === "briefing") {
        const store = new BriefingStore(ctx.state, companyId);
        const entries = await store.load();
        const briefing = synthesizeBriefing(entries);
        if (String(input.query.clear ?? "") === "1") await store.clear();
        return { body: { briefing, count: entries.length } };
      }

      return { status: 404, body: { error: `Unknown route: ${input.routeKey}` } };
    } catch (e) {
      return { status: 400, body: { error: e instanceof Error ? e.message : String(e) } };
    }
  },

  async onHealth() {
    return { status: "ok", message: "command-center worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
