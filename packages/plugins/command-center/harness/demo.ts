/**
 * End-to-end demo of the CEO command center, V0–V3, against the in-memory host.
 * Run: pnpm demo
 *
 * Shows: V3 role-stack injection (connect a Claude Code as CEO -> OperatorOS drops
 * in), V0 decompose+dispatch+report through the governed seam, V1 live events +
 * cross-turn memory, V2 the QA verify gate (pass AND fail), and the autonomy gate
 * pausing on a destructive objective.
 */
import { StackRegistry } from "../src/stacks/role-stacks";
import { OrgBuilder } from "../src/org/org";
import type { Org } from "../src/core/types";
import { describeInjection } from "../src/stacks/stack-injector";
import { CEO } from "../src/brain/ceo";
import { InMemoryMemoryStore } from "../src/memory/memory-store";
import type { CcEvent, EventSink } from "../src/core/ports";
import { FakeHands, makeFakeClock, makeFakeIdGen, instantMonitor, type FakeHandsConfig } from "./fakes";

function hr(title: string) {
  console.log("\n" + "═".repeat(72) + `\n${title}\n` + "═".repeat(72));
}

const consoleSink: EventSink = {
  emit(e: CcEvent) {
    const tag: Record<CcEvent["type"], string> = {
      "ceo.thinking": "🧠 CEO",
      "ceo.plan": "📋 PLAN",
      "task.dispatched": "📤 DISPATCH",
      "task.progress": "… PROGRESS",
      "task.result": "📥 RESULT",
      "qa.verdict": "🔬 QA",
      "ceo.report": "📣 REPORT",
      "ceo.awaiting_human": "⏸️  GATE",
    };
    const detail =
      e.type === "ceo.plan" ? `${e.summary} (${e.taskCount} tasks)`
      : e.type === "task.dispatched" ? `${e.taskId} → ${e.role} (issue ${e.issueId})`
      : e.type === "task.result" ? `${e.taskId}: ${e.status}`
      : e.type === "qa.verdict" ? `${e.taskId}: ${e.passed ? "PASS" : "FAIL"}`
      : e.type === "ceo.awaiting_human" ? e.question
      : "text" in e ? e.text : "";
    if (e.type !== "ceo.report") console.log(`   ${tag[e.type]}  ${detail}`);
  },
};

function buildOrg(registry: StackRegistry): Org {
  const builder = new OrgBuilder(registry, "company_hivra", "goal_root")
    .connect({ role: "ceo", agentId: "agent_claude_code_1" }) // OperatorOS auto-injects
    .connect({ role: "engineer", agentId: "agent_codex_1", stackId: "engineer-codex" }) // different stack, same role
    .connect({ role: "qa", agentId: "agent_qa_1" })
    .connect({ role: "researcher", agentId: "agent_research_1" })
    .connect({ role: "marketer", agentId: "agent_marketer_1" });

  hr("V3 — Connect agents to roles; stacks auto-inject");
  for (const role of ["ceo", "engineer", "qa", "researcher", "marketer"] as const) {
    const conn = builder.connectionFor(role);
    if (conn) console.log("• " + describeInjection(conn));
  }
  return builder.build();
}

async function runTurn(label: string, ceo: CEO, objective: string, conversationId: string) {
  hr(label);
  console.log(`👤 operator: ${objective}\n`);
  const reply = await ceo.handleObjective(objective, conversationId);
  console.log("\n" + reply.text);
  return reply;
}

async function main() {
  const registry = new StackRegistry();
  const clock = makeFakeClock();
  const newId = makeFakeIdGen();
  const memory = new InMemoryMemoryStore();
  const org = buildOrg(registry);

  // --- happy path (V0 + V1 + V2 pass) ---
  const hands = new FakeHands(newId, clock, { qa: "pass" });
  const ceo = new CEO({ org, registry, hands, memory, clock, newId, monitor: instantMonitor, events: consoleSink });

  await runTurn("V0/V2 — Decompose, dispatch, verify, report", ceo, "Build a pricing page for Hivra and QA it before shipping.", "conv_1");
  await runTurn("V1 — Same conversation, memory persists", ceo, "Now research our top 3 competitors' pricing and have marketing draft the comparison copy.", "conv_1");

  // --- autonomy gate (destructive objective pauses) ---
  await runTurn("Autonomy gate — destructive objective is held for the human", ceo, "Delete the production database and rebuild it from scratch.", "conv_1");

  // --- QA fail path (V2 enforces ground truth) ---
  const failHands = new FakeHands(newId, clock, { qa: "fail" } satisfies FakeHandsConfig);
  const ceo2 = new CEO({ org, registry, hands: failHands, memory, clock, newId, monitor: instantMonitor, events: consoleSink });
  await runTurn("V2 — QA fails, CEO does NOT declare done", ceo2, "Build the onboarding empty-state screen.", "conv_2");

  // --- memory inspection ---
  hr("V1 — Memory after the conversation");
  const mem = await memory.load("conv_1");
  console.log(`conv_1 has ${mem.turns.length} retained turns; summary length ${mem.summary.length} chars.`);

  hr("Done — V0–V3 ran end to end against the in-memory host.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
