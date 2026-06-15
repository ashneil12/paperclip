import { describe, it, expect } from "vitest";
import { advanceRun, newRunState, type RunDeps } from "../src/brain/run";
import { StackRegistry } from "../src/stacks/role-stacks";
import { OrgBuilder } from "../src/org/org";
import { FakeHands, makeFakeClock, makeFakeIdGen, instantMonitor, type FakeHandsConfig } from "../harness/fakes";
import type { Plan, RunState } from "../src/core/types";

function setup(cfg: FakeHandsConfig, maxRework?: number) {
  const registry = new StackRegistry();
  const newId = makeFakeIdGen();
  const org = new OrgBuilder(registry, "co", "g")
    .connect({ role: "ceo", agentId: "ceo1" })
    .connect({ role: "engineer", agentId: "eng1" })
    .connect({ role: "qa", agentId: "qa1" })
    .build();
  const hands = new FakeHands(newId, makeFakeClock(), cfg);
  const deps: RunDeps = { org, registry, hands, newId, monitor: instantMonitor, maxRework };
  return { hands, deps };
}

function plan(): Plan {
  return {
    objectiveId: "obj1",
    summary: "Build the pricing page",
    rationale: "",
    tasks: [
      { id: "t1", title: "Build pricing page", description: "Build it.", role: "engineer", dependsOn: [], acceptanceCriteria: "3 tiers + working CTA", needsQA: true, status: "planned" },
    ],
  };
}

async function drain(state: RunState, deps: RunDeps) {
  for (let i = 0; i < 40; i++) {
    if ((await advanceRun(state, deps)).done) return;
  }
  throw new Error("run did not converge");
}

const dispatchIssues = (hands: FakeHands) =>
  [...hands.issues.values()].filter((i) => i.originKind === "plugin:command-center:dispatch");

describe("Engineer↔QA auto-rework loop (self-healing gate)", () => {
  it("re-dispatches with QA findings on FAIL, then settles GREEN when the rework passes", async () => {
    const { hands, deps } = setup({ qaFailFirst: 1 }, 2); // fail once, then pass
    const state = newRunState("c1", "Build the pricing page", plan());
    await drain(state, deps);

    expect(state.verdicts["t1"]?.passed).toBe(true); // ended green
    expect(state.reworks?.["t1"]).toBe(1); // exactly one rework spent

    const dispatches = dispatchIssues(hands);
    expect(dispatches).toHaveLength(2); // original + one rework
    // the rework dispatch carried the QA findings into the engineer's brief
    expect(dispatches[1]!.description).toMatch(/Rework \(attempt 1 of 2\)/);
    expect(dispatches[1]!.description).toMatch(/empty-state copy/i);
  });

  it("gives up after maxRework and settles the task as FAIL — it never loops forever", async () => {
    const { hands, deps } = setup({ qa: "fail" }, 2); // always fails
    const state = newRunState("c2", "Build the pricing page", plan());
    await drain(state, deps);

    expect(state.done).toBe(true);
    expect(state.verdicts["t1"]?.passed).toBe(false); // settled as failed
    expect(state.reworks?.["t1"]).toBe(2); // spent both attempts
    expect(dispatchIssues(hands)).toHaveLength(3); // original + 2 reworks
  });

  it("does not rework when QA passes on the first attempt", async () => {
    const { hands, deps } = setup({ qa: "pass" });
    const state = newRunState("c3", "Build", plan());
    await drain(state, deps);

    expect(state.verdicts["t1"]?.passed).toBe(true);
    expect(state.reworks?.["t1"] ?? 0).toBe(0);
    expect(dispatchIssues(hands)).toHaveLength(1);
  });

  it("honors a custom maxRework of 0 (one shot, no rework)", async () => {
    const { hands, deps } = setup({ qa: "fail" }, 0);
    const state = newRunState("c4", "Build", plan());
    await drain(state, deps);

    expect(state.verdicts["t1"]?.passed).toBe(false);
    expect(state.reworks?.["t1"] ?? 0).toBe(0);
    expect(dispatchIssues(hands)).toHaveLength(1); // never re-dispatched
  });
});
