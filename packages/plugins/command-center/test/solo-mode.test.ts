import { describe, it, expect } from "vitest";
import { CEO } from "../src/brain/ceo";
import { StackRegistry } from "../src/stacks/role-stacks";
import { OrgBuilder, resolveMember } from "../src/org/org";
import { InMemoryMemoryStore } from "../src/memory/memory-store";
import { FakeHands, makeFakeClock, makeFakeIdGen, instantMonitor } from "../harness/fakes";

describe("solo / self-staffing mode (connect ONE CC, it just works)", () => {
  it("self-staffs an unfilled role with the CEO's agent + that role's stack", () => {
    const reg = new StackRegistry();
    const org = new OrgBuilder(reg, "co", "g").connect({ role: "ceo", agentId: "cc1" }).build();
    const eng = resolveMember(org, reg, "engineer");
    expect(eng.agentId).toBe("cc1"); // the CEO's own agent wears the hat
    expect(eng.stackId).toBe("engineer-claude-code"); // engineer stack still injected
  });

  it("throws when solo is off and a role is unfilled", () => {
    const reg = new StackRegistry();
    const org = new OrgBuilder(reg, "co", "g").setSolo(false).connect({ role: "ceo", agentId: "cc1" }).build();
    expect(() => resolveMember(org, reg, "engineer")).toThrow(/solo mode is off/i);
  });

  it("a single connected CC plans AND executes — dispatch runs via self-staff", async () => {
    const reg = new StackRegistry();
    const clock = makeFakeClock();
    const newId = makeFakeIdGen();
    const org = new OrgBuilder(reg, "co", "g").connect({ role: "ceo", agentId: "cc1" }).build();
    const hands = new FakeHands(newId, clock, { qa: "pass" });
    const ceo = new CEO({ org, registry: reg, hands, memory: new InMemoryMemoryStore(), clock, newId, monitor: instantMonitor });

    const reply = await ceo.handleObjective("Build and ship a pricing page", "c1");
    expect(hands.wakeups.length).toBeGreaterThan(0); // executed despite only the CEO being connected
    const dispatched = [...hands.issues.values()].find((i) => i.originKind === "plugin:command-center:dispatch");
    expect(dispatched?.assigneeAgentId).toBe("cc1"); // self-staffed onto the CEO's agent
    expect(dispatched?.overrides?.adapterKind).toBe("claude"); // engineer-claude-code stack injected
    expect(reply.text).toMatch(/Shipped|Needs/);
  });

  it("availableRoles exposes the whole org in solo mode", () => {
    const reg = new StackRegistry();
    const clock = makeFakeClock();
    const newId = makeFakeIdGen();
    const org = new OrgBuilder(reg, "co", "g").connect({ role: "ceo", agentId: "cc1" }).build();
    const ceo = new CEO({ org, registry: reg, hands: new FakeHands(newId, clock), memory: new InMemoryMemoryStore(), clock, newId, monitor: instantMonitor });
    const roles = ceo.availableRoles();
    expect(roles).toContain("engineer");
    expect(roles).toContain("qa");
    expect(roles).toContain("marketer");
    expect(roles).not.toContain("ceo");
  });
});
