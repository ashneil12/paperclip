import { describe, it, expect } from "vitest";
import { classifyTaskDecision, requiresHuman } from "../src/brain/autonomy";
import type { Task } from "../src/core/types";

const task = (over: Partial<Task>): Task => ({
  id: "t",
  title: "do a thing",
  description: "",
  role: "engineer",
  dependsOn: [],
  acceptanceCriteria: "",
  needsQA: false,
  status: "planned",
  ...over,
});

describe("autonomy gate (act-then-report)", () => {
  it("proceeds on a reversible task", () => {
    const d = classifyTaskDecision(task({ title: "Add a settings toggle" }));
    expect(requiresHuman(d, "act-then-report")).toBeNull();
  });

  it("pauses on a destructive/irreversible task", () => {
    const d = classifyTaskDecision(task({ title: "Delete the production database" }));
    expect(requiresHuman(d, "act-then-report")).toMatch(/irreversible|governance/i);
  });

  it("pauses when estimated spend exceeds the ceiling", () => {
    const d = classifyTaskDecision(task({ title: "Run a paid campaign" }), 100);
    expect(requiresHuman(d, "act-then-report", { spendCeilingUsd: 50 })).toMatch(/spend/i);
  });

  it("ask-first posture pauses even reversible work", () => {
    const d = classifyTaskDecision(task({ title: "Add a toggle" }));
    expect(requiresHuman(d, "ask-first")).toMatch(/ask-first/i);
  });

  it("read-only posture never dispatches", () => {
    const d = classifyTaskDecision(task({ title: "Add a toggle" }));
    expect(requiresHuman(d, "read-only")).toMatch(/read-only/i);
  });
});
