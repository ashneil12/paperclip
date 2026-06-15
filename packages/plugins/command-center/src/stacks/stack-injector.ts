/**
 * Stack injection — the mechanism behind "connect a Claude Code as the CEO and
 * the OperatorOS stack drops in automatically."
 *
 * Connecting an agent to a role:
 *   1. picks the role's stack (its default, or an explicit override),
 *   2. binds the agent id to the role as an OrgMember,
 *   3. resolves the stack into AdapterOverrides that travel with every task
 *      dispatched to that member — so the worker runs with that member's persona,
 *      skills, tools, model, and adapter, not the host defaults.
 */
import type { OrgMember, RoleId, RoleStack } from "../core/types";
import type { AdapterOverrides } from "../core/ports";
import type { StackRegistry } from "./role-stacks";

/** Turn a RoleStack into the per-task overrides Paperclip applies to the run. */
export function resolveAdapterOverrides(stack: RoleStack): AdapterOverrides {
  return {
    adapterKind: stack.adapterKind,
    model: stack.model,
    systemPromptAppend: stack.persona,
    toolAllowlist: [...stack.tools],
    skills: [...stack.skills],
  };
}

export interface ConnectParams {
  role: RoleId;
  agentId: string;
  /** Optional human-facing title; defaults from the stack. */
  title?: string;
  displayName?: string;
  /** Override which stack fills this role (defaults to the role's default stack). */
  stackId?: string;
}

export interface Connection {
  member: OrgMember;
  stack: RoleStack;
  overrides: AdapterOverrides;
}

/**
 * Connect an agent to a role and auto-inject its stack. This is the function the
 * UI calls when you drag a Claude Code onto the "CEO" seat.
 */
export function connectAgentToRole(registry: StackRegistry, params: ConnectParams): Connection {
  const stack = params.stackId
    ? requireStack(registry, params.stackId)
    : registry.defaultStackFor(params.role);

  if (stack.role !== params.role) {
    // Allow it, but the stack was authored for a different role — surface it.
    // (e.g. putting the marketer stack on a "founder" seat.)
  }

  const member: OrgMember = {
    role: params.role,
    title: params.title ?? stack.displayName,
    agentId: params.agentId,
    stackId: stack.id,
    displayName: params.displayName ?? stack.displayName,
  };

  return { member, stack, overrides: resolveAdapterOverrides(stack) };
}

function requireStack(registry: StackRegistry, stackId: string): RoleStack {
  const stack = registry.get(stackId);
  if (!stack) throw new Error(`Unknown stack: ${stackId}`);
  return stack;
}

/** Human-readable summary of what just got injected — for the chat/log. */
export function describeInjection(conn: Connection): string {
  const { member, stack } = conn;
  return [
    `Connected agent ${member.agentId} as ${member.title} (role: ${member.role}).`,
    `Injected stack "${stack.displayName}": ${stack.adapterKind}/${stack.model}, ` +
      `${stack.skills.length} skill(s) [${stack.skills.join(", ")}], ` +
      `${stack.tools.length} tool grant(s), autonomy: ${stack.autonomy}.`,
  ].join(" ");
}
