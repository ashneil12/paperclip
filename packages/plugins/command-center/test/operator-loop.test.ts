import { describe, it, expect } from "vitest";
import { CEO } from "../src/brain/ceo";
import { StackRegistry } from "../src/stacks/role-stacks";
import { OrgBuilder } from "../src/org/org";
import { InMemoryMemoryStore } from "../src/memory/memory-store";
import { OperatorLoop } from "../src/brain/operator-loop";
import { synthesizeBriefing } from "../src/brain/briefing";
import { formatSpend } from "../src/brain/cost";
import { FakeHands, makeFakeClock, makeFakeIdGen, instantMonitor } from "../harness/fakes";

function makeCeo(qa: "pass" | "fail" = "pass") {
  const reg = new StackRegistry();
  const clock = makeFakeClock();
  const newId = makeFakeIdGen();
  // One CC connected to every role — the turnkey single-session setup.
  const org = new OrgBuilder(reg, "co", "g")
    .connect({ role: "ceo", agentId: "cc1" })
    .connect({ role: "engineer", agentId: "cc1" })
    .connect({ role: "qa", agentId: "cc1" })
    .connect({ role: "researcher", agentId: "cc1" })
    .build();
  const hands = new FakeHands(newId, clock, { qa });
  return new CEO({ org, registry: reg, hands, memory: new InMemoryMemoryStore(), clock, newId, monitor: instantMonitor });
}

describe("spend estimate (subscription-burn awareness)", () => {
  it("reply carries estimated spend with a per-role breakdown", async () => {
    const reply = await makeCeo("pass").handleObjective("Build and ship a pricing page", "c1");
    expect(reply.spend).toBeTruthy();
    expect(reply.spend!.totalUsd).toBeGreaterThan(0);
    expect(reply.spend!.byRole.engineer).toBeGreaterThan(0);
    expect(reply.spend!.byRole.qa).toBeGreaterThan(0); // a QA task was spawned
    expect(formatSpend(reply.spend!)).toMatch(/Spend: ~\$/);
  });
});

describe("operator loop + morning briefing", () => {
  it("drains a backlog and produces a 'while you were away' briefing", async () => {
    const loop = new OperatorLoop(makeCeo("pass"));
    await loop.enqueue(
      "Build and ship a pricing page",
      "Research our top 3 competitors' pricing",
      "Delete the production database", // hits the autonomy gate
    );
    expect(await loop.pending()).toBe(3);

    const entries = await loop.drain();
    expect(entries).toHaveLength(3);
    expect(await loop.pending()).toBe(0);

    const briefing = loop.briefing("overnight");
    expect(briefing).toMatch(/Good morning/);
    expect(briefing).toMatch(/Shipped/);
    expect(briefing).toMatch(/Needs your call/); // the destructive objective was held
    expect(briefing).toMatch(/Spend: ~\$/);
    expect(briefing).toMatch(/Start here/);
  });

  it("empty backlog → honest idle briefing", () => {
    expect(synthesizeBriefing([])).toMatch(/Nothing was queued/);
  });
});
