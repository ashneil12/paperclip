import { describe, it, expect } from "vitest";
import { CEO } from "../src/brain/ceo";
import { StackRegistry } from "../src/stacks/role-stacks";
import { OrgBuilder } from "../src/org/org";
import { InMemoryMemoryStore } from "../src/memory/memory-store";
import { FakeHands, makeFakeClock, makeFakeIdGen, instantMonitor, ScriptedLLM } from "../harness/fakes";
import type { LLM } from "../src/core/ports";

function build(llm?: LLM) {
  const registry = new StackRegistry();
  const clock = makeFakeClock();
  const newId = makeFakeIdGen();
  const org = new OrgBuilder(registry, "co", "goal_root")
    .connect({ role: "ceo", agentId: "ceo1" })
    .connect({ role: "engineer", agentId: "eng1" })
    .connect({ role: "qa", agentId: "qa1" })
    .connect({ role: "researcher", agentId: "r1" })
    .build();
  const hands = new FakeHands(newId, clock, { qa: "pass" });
  const ceo = new CEO({ org, registry, hands, memory: new InMemoryMemoryStore(), clock, newId, llm, monitor: instantMonitor });
  return { ceo, hands };
}

describe("resumable run cycle (host dispatch/poll)", () => {
  it("advances incrementally: dispatch+collect on tick 1, QA verdict by a later tick", async () => {
    const { ceo, hands } = build();
    const state = await ceo.startRun("Build and ship a pricing page", "c1");
    expect(Object.keys(state.dispatched)).toHaveLength(0);

    const t1 = await ceo.tick(state);
    expect(Object.keys(state.dispatched).length).toBeGreaterThan(0); // dispatched this tick
    expect(t1.done).toBe(false); // QA verdict not in yet

    // Drain remaining ticks.
    let done = t1.done;
    for (let i = 0; i < 10 && !done; i++) done = (await ceo.tick(state)).done;
    expect(done).toBe(true);
    expect(Object.values(state.verdicts)[0]?.passed).toBe(true);
    expect(hands.wakeups.length).toBeGreaterThanOrEqual(2); // build + QA woken
  });
});

describe("LLM planning path with dependencies", () => {
  it("runs an LLM plan, respecting dependsOn ordering, and ships both", async () => {
    const plan = {
      summary: "Research then build the comparison page",
      tasks: [
        { title: "Research competitor pricing", role: "researcher", acceptanceCriteria: "3 competitors, cited" },
        { title: "Build the comparison page", role: "engineer", acceptanceCriteria: "renders, CTA works", dependsOn: [0], needsQA: true },
      ],
    };
    const { ceo, hands } = build(new ScriptedLLM(plan));
    const reply = await ceo.handleObjective("Make a competitor comparison page", "c2");

    expect(reply.plan!.tasks).toHaveLength(2);
    expect(reply.plan!.tasks[1]!.dependsOn).toEqual([reply.plan!.tasks[0]!.id]);
    expect(reply.text).toMatch(/Shipped/);
    expect(reply.awaitingHuman).toBe(false);
    // research, build, and QA all woken
    expect(hands.wakeups.length).toBeGreaterThanOrEqual(3);

    // dependency order: the research issue is created before the build issue.
    const created = [...hands.issues.values()];
    const researchIdx = created.findIndex((i) => i.title.includes("Research"));
    const buildIdx = created.findIndex((i) => i.title.includes("Build the comparison"));
    expect(researchIdx).toBeGreaterThanOrEqual(0);
    expect(buildIdx).toBeGreaterThan(researchIdx);
  });
});
