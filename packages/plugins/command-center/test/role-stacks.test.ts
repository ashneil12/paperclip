import { describe, it, expect } from "vitest";
import { StackRegistry, CEO_STACK } from "../src/stacks/role-stacks";
import { connectAgentToRole, resolveAdapterOverrides, describeInjection } from "../src/stacks/stack-injector";

describe("V3 — role stacks", () => {
  it("auto-injects the OperatorOS stack when an agent is connected as CEO", () => {
    const reg = new StackRegistry();
    const conn = connectAgentToRole(reg, { role: "ceo", agentId: "agent_claude_1" });
    expect(conn.stack.id).toBe("operatoros");
    expect(conn.member.agentId).toBe("agent_claude_1");
    expect(conn.overrides.systemPromptAppend).toContain("Operator OS");
    expect(conn.overrides.skills).toContain("operatoros-kb");
    expect(describeInjection(conn)).toMatch(/OperatorOS/);
  });

  it("carries persona, tools, model and adapter into adapter overrides", () => {
    const o = resolveAdapterOverrides(CEO_STACK);
    expect(o.model).toBe("claude-opus-4-8");
    expect(o.adapterKind).toBe("claude");
    expect(o.toolAllowlist).toContain("issues.create");
    expect(o.systemPromptAppend).toContain("CEO of an agent company");
  });

  it("lets the same role run a different stack (engineer -> Codex)", () => {
    const reg = new StackRegistry();
    const conn = connectAgentToRole(reg, { role: "engineer", agentId: "e1", stackId: "engineer-codex" });
    expect(conn.overrides.adapterKind).toBe("codex");
    expect(conn.overrides.model).toBe("gpt-5-codex");
  });

  it("defaults a role to its first registered stack", () => {
    const reg = new StackRegistry();
    expect(reg.defaultStackFor("engineer").id).toBe("engineer-claude-code");
  });
});
