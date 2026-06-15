import { describe, it, expect } from "vitest";
import { heuristicPlan, coercePlan } from "../src/brain/planner";
import { makeFakeIdGen } from "../harness/fakes";
import type { Objective } from "../src/core/types";

const obj = (text: string): Objective => ({ id: "obj_1", text, conversationId: "c", requestedBy: "op" });

describe("planner", () => {
  it("routes a build objective to engineer with the QA gate flagged", () => {
    const plan = heuristicPlan(obj("Build and ship a pricing page"), { availableRoles: ["engineer", "qa"] }, makeFakeIdGen());
    const eng = plan.tasks.find((t) => t.role === "engineer");
    expect(eng).toBeTruthy();
    expect(eng!.needsQA).toBe(true);
    expect(plan.tasks.some((t) => t.role === "qa")).toBe(false); // gate spawns QA, not the planner
  });

  it("routes research objectives to the researcher", () => {
    const plan = heuristicPlan(obj("Research competitor pricing"), { availableRoles: ["researcher", "engineer", "qa"] }, makeFakeIdGen());
    expect(plan.tasks.some((t) => t.role === "researcher")).toBe(true);
  });

  it("coerces an LLM plan and resolves dependsOn indices to task ids", () => {
    const raw = {
      summary: "s",
      tasks: [
        { title: "Research", role: "researcher", acceptanceCriteria: "x" },
        { title: "Build", role: "engineer", acceptanceCriteria: "y", dependsOn: [0], needsQA: true },
      ],
    };
    const plan = coercePlan(obj("x"), raw, { availableRoles: ["researcher", "engineer"] }, makeFakeIdGen());
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[1]!.dependsOn).toEqual([plan.tasks[0]!.id]);
  });

  it("normalizes an unknown role onto an available one", () => {
    const raw = { summary: "s", tasks: [{ title: "T", role: "wizard", acceptanceCriteria: "z" }] };
    const plan = coercePlan(obj("x"), raw, { availableRoles: ["engineer"] }, makeFakeIdGen());
    expect(plan.tasks[0]!.role).toBe("engineer");
  });
});
