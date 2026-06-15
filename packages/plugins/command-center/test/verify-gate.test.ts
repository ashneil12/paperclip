import { describe, it, expect } from "vitest";
import { runVerifyGate, parseVerdict } from "../src/qa/verify-gate";
import { StackRegistry } from "../src/stacks/role-stacks";
import { OrgBuilder } from "../src/org/org";
import { FakeHands, makeFakeClock, makeFakeIdGen, instantMonitor } from "../harness/fakes";
import type { HandsComment } from "../src/core/ports";
import type { Task, TaskRunResult } from "../src/core/types";

const task = (): Task => ({
  id: "task_1",
  title: "Build pricing page",
  description: "d",
  role: "engineer",
  dependsOn: [],
  acceptanceCriteria: "Has three tiers and a working CTA.",
  needsQA: true,
  status: "planned",
});
const work = (): TaskRunResult => ({ taskId: "task_1", issueId: "issue_x", status: "done", resultSummary: "built it" });

function orgWith(registry: StackRegistry, qa: boolean) {
  const b = new OrgBuilder(registry, "co", "g").connect({ role: "ceo", agentId: "ceo1" }).connect({ role: "engineer", agentId: "eng1" });
  if (qa) b.connect({ role: "qa", agentId: "qa1" });
  return b.build();
}

describe("V2 — verify gate", () => {
  it("passes when QA returns PASS", async () => {
    const registry = new StackRegistry();
    const hands = new FakeHands(makeFakeIdGen(), makeFakeClock(), { qa: "pass" });
    const v = await runVerifyGate(task(), work(), { hands, registry, org: orgWith(registry, true), newId: makeFakeIdGen(), ceoAgentId: "ceo1", monitor: instantMonitor });
    expect(v.passed).toBe(true);
    expect(v.qaIssueId).toBeTruthy();
  });

  it("fails (with findings) when QA returns FAIL", async () => {
    const registry = new StackRegistry();
    const hands = new FakeHands(makeFakeIdGen(), makeFakeClock(), { qa: "fail" });
    const v = await runVerifyGate(task(), work(), { hands, registry, org: orgWith(registry, true), newId: makeFakeIdGen(), ceoAgentId: "ceo1", monitor: instantMonitor });
    expect(v.passed).toBe(false);
    expect(v.findings.length).toBeGreaterThan(0);
  });

  it("skips with an honest note when no QA member is connected", async () => {
    const registry = new StackRegistry();
    const hands = new FakeHands(makeFakeIdGen(), makeFakeClock(), { qa: "pass" });
    const v = await runVerifyGate(task(), work(), { hands, registry, org: orgWith(registry, false), newId: makeFakeIdGen(), ceoAgentId: "ceo1", monitor: instantMonitor });
    expect(v.passed).toBe(true);
    expect(v.findings[0]).toMatch(/skipped/i);
  });
});

describe("parseVerdict — two-lane gate (deterministic authoritative, Midscene advisory)", () => {
  const comment = (body: string): HandsComment[] => [
    { id: "c1", body, authorKind: "agent", createdAt: "2026-06-16T00:00:00.000Z" },
  ];

  it("takes the deterministic VERDICT line as authoritative and parses gate findings", () => {
    const v = parseVerdict("t1", "qa1", "done", comment("VERDICT: PASS\n- 3 tiers render\n- CTA navigates to /checkout"));
    expect(v.passed).toBe(true);
    expect(v.findings).toEqual(["3 tiers render", "CTA navigates to /checkout"]);
    expect(v.advisory).toBeUndefined();
  });

  it("captures ADVISORY (Midscene) notes separately and never lets them flip the gate", () => {
    const v = parseVerdict("t1", "qa1", "done", comment("VERDICT: PASS\n- all criteria proven by Playwright\nADVISORY: hero CTA contrast reads low on mobile"));
    expect(v.passed).toBe(true);
    expect(v.findings).toEqual(["all criteria proven by Playwright"]);
    expect(v.advisory).toEqual(["hero CTA contrast reads low on mobile"]);
  });

  it("keeps a gate FAIL even when the advisory lane is positive", () => {
    const v = parseVerdict("t1", "qa1", "done", comment("VERDICT: FAIL\n- checkout CTA 404s\nADVISORY: copy looks clean and on-brand"));
    expect(v.passed).toBe(false);
    expect(v.findings).toEqual(["checkout CTA 404s"]);
    expect(v.advisory).toEqual(["copy looks clean and on-brand"]);
  });

  it("defaults to FAIL when no VERDICT line is present", () => {
    const v = parseVerdict("t1", "qa1", "done", comment("looks good to me"));
    expect(v.passed).toBe(false);
    expect(v.findings.length).toBeGreaterThan(0);
  });
});
