/**
 * The org: a company scope, a default goal (ancestry for all dispatched work),
 * and a roster of members (role -> bound agent + injected stack).
 *
 * Solo / self-staffing (default ON): if a role has no dedicated member, the CEO's
 * own agent fills it running that role's stack. So connecting ONE Claude Code as
 * the CEO is enough — it plans as CEO and executes as engineer / qa / researcher /
 * marketer, each with the right stack injected. Connect more agents later to give
 * roles their own dedicated seats.
 */
import type { Org, OrgMember, RoleId } from "../core/types";
import type { StackRegistry } from "../stacks/role-stacks";
import { connectAgentToRole, type ConnectParams, type Connection } from "../stacks/stack-injector";

export class OrgBuilder {
  private members: OrgMember[] = [];
  private connections = new Map<RoleId, Connection>();
  private solo = true;

  constructor(
    private readonly registry: StackRegistry,
    private readonly companyId: string,
    private readonly defaultGoalId?: string,
  ) {}

  /** Connect an agent to a role; its stack drops in automatically. */
  connect(params: ConnectParams): this {
    const conn = connectAgentToRole(this.registry, params);
    // One member per role: re-connecting replaces the seat.
    this.members = this.members.filter((m) => m.role !== params.role);
    this.members.push(conn.member);
    this.connections.set(params.role, conn);
    return this;
  }

  /** Toggle solo / self-staffing. Default true. */
  setSolo(enabled: boolean): this {
    this.solo = enabled;
    return this;
  }

  connectionFor(role: RoleId): Connection | undefined {
    return this.connections.get(role);
  }

  build(): Org {
    if (!this.members.some((m) => m.role === "ceo")) {
      throw new Error("Org needs a CEO. Connect an agent to the 'ceo' role.");
    }
    return { companyId: this.companyId, defaultGoalId: this.defaultGoalId, members: [...this.members], soloFallback: this.solo };
  }
}

export function memberForRole(org: Org, role: RoleId): OrgMember | undefined {
  return org.members.find((m) => m.role === role);
}

export function ceoOf(org: Org): OrgMember {
  const ceo = memberForRole(org, "ceo");
  if (!ceo) throw new Error("Org has no CEO");
  return ceo;
}

/**
 * Resolve the member who should run a role. Returns the dedicated member if one is
 * connected; otherwise, in solo mode, a synthetic member backed by the CEO's agent
 * running the role's default stack. Throws only when no member exists and solo is
 * off. This is the self-staffing seam.
 */
export function resolveMember(org: Org, registry: StackRegistry, role: RoleId): OrgMember {
  const dedicated = memberForRole(org, role);
  if (dedicated) return dedicated;
  if (org.soloFallback === false) {
    throw new Error(`No org member is connected to role "${role}" and solo mode is off.`);
  }
  const ceo = ceoOf(org);
  const stack = registry.defaultStackFor(role);
  return {
    role,
    title: `${stack.displayName} (CEO solo)`,
    agentId: ceo.agentId, // the CEO's own agent wears this hat
    stackId: stack.id,
    displayName: `${stack.displayName} (self-staffed)`,
  };
}

/** Whether a role can be staffed at all (dedicated member, or solo fallback). */
export function canStaffRole(org: Org, registry: StackRegistry, role: RoleId): boolean {
  if (memberForRole(org, role)) return true;
  if (org.soloFallback === false) return false;
  try {
    registry.defaultStackFor(role);
    return true;
  } catch {
    return false;
  }
}
