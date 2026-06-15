import { describe, it, expect } from "vitest";
import { CEO } from "../src/brain/ceo";
import { StackRegistry } from "../src/stacks/role-stacks";
import { OrgBuilder } from "../src/org/org";
import { InMemoryMemoryStore } from "../src/memory/memory-store";
import { FakeHands, makeFakeClock, makeFakeIdGen, instantMonitor } from "../harness/fakes";

function build(qa: "pass" | "fail" = "pass") {
  const registry = new StackRegistry();
  const clock = makeFakeClock();
  const newId = makeFakeIdGen();
  const org = new OrgBuilder(registry, "co", "goal_root")
    .connect({ role: "ceo", agentId: "ceo1" })
    .connect({ role: "engineer", agentId: "eng1" })
    .connect({ role: "qa", agentId: "qa1" })
    .connect({ role: "researcher", agentId: "r1" })
    .connect({ role: "marketer", agentId: "m1" })
    .build();
  const hands = new FakeHands(newId, clock, { qa });
  const memory = new InMemoryMemoryStore();
  const ceo = new CEO({ org, registry, hands, memory, clock, newId, monitor: instantMonitor });
  return { ceo, hands, memory };
}

describe("CEO end-to-end", () => {
  it("V0/V2: decomposes, dispatches through the seam, verifies, and reports", async () => {
    const { ceo, hands } = build("pass");
    const reply = await ceo.handleObjective("Build and ship a pricing page", "conv_1");
    expect(reply.plan!.tasks.length).toBeGreaterThan(0);
    expect(hands.wakeups.length).toBeGreaterThan(0);
    expect(reply.actions.some((a) => a.kind === "dispatch")).toBe(true);
    expect(reply.actions.some((a) => a.kind === "qa")).toBe(true);
    expect(reply.text).toMatch(/Shipped/);
    expect(reply.awaitingHuman).toBe(false);
  });

  it("autonomy: pauses on a destructive objective", async () => {
    const { ceo, hands } = build("pass");
    const reply = await ceo.handleObjective("Delete the production database and rebuild it", "conv_2");
    expect(reply.awaitingHuman).toBe(true);
    expect(reply.actions.some((a) => a.kind === "ask")).toBe(true);
    expect(hands.asks.length).toBeGreaterThan(0);
  });

  it("V2: does not declare done when QA fails", async () => {
    const { ceo } = build("fail");
    const reply = await ceo.handleObjective("Build the onboarding empty-state screen", "conv_3");
    expect(reply.text).toMatch(/Needs rework|QA FAILED/i);
  });

  it("V1: persists memory across turns in a conversation", async () => {
    const { ceo, memory } = build("pass");
    await ceo.handleObjective("Build a pricing page", "conv_4");
    await ceo.handleObjective("Now add an FAQ section", "conv_4");
    const mem = await memory.load("conv_4");
    expect(mem.turns.length).toBeGreaterThanOrEqual(2);
  });
});
