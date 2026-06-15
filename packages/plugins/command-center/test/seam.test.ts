import { describe, it, expect } from "vitest";
import { dispatchTask, routeTask, NoMemberForRoleError } from "../src/brain/router";
import { StackRegistry } from "../src/stacks/role-stacks";
import { OrgBuilder } from "../src/org/org";
import { FakeHands, makeFakeClock, makeFakeIdGen } from "../harness/fakes";
import type { Task } from "../src/core/types";

function setup() {
  const registry = new StackRegistry();
  const clock = makeFakeClock();
  const newId = makeFakeIdGen();
  const org = new OrgBuilder(registry, "co", "goal_root")
    .connect({ role: "ceo", agentId: "ceo1" })
    .connect({ role: "engineer", agentId: "eng1", stackId: "engineer-codex" })
    .build();
  const hands = new FakeHands(newId, clock);
  return { registry, clock, newId, org, hands };
}

const task = (over: Partial<Task> = {}): Task => ({
  id: "task_1",
  title: "Build a thing",
  description: "d",
  role: "engineer",
  dependsOn: [],
  acceptanceCriteria: "a",
  needsQA: false,
  status: "planned",
  ...over,
});

describe("the governed seam", () => {
  it("creates the task with the member's stack injected and explicitly wakes it", async () => {
    const { registry, org, hands, newId } = setup();
    const rec = await dispatchTask(task(), [], { hands, registry, org, newId, ceoAgentId: "ceo1" });
    expect(rec.assigneeAgentId).toBe("eng1");
    expect(rec.wakeupQueued).toBe(true);
    expect(hands.wakeups).toContain(rec.issueId);

    const issue = [...hands.issues.values()].find((i) => i.id === rec.issueId)!;
    expect(issue.overrides?.adapterKind).toBe("codex"); // engineer-codex stack injected at dispatch
  });

  it("throws when no member is connected to the task's role", () => {
    const { org } = setup();
    expect(() => routeTask(task({ role: "designer" }), org)).toThrow(NoMemberForRoleError);
  });
});
