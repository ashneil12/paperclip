/**
 * Routing + dispatch — turn a planned task into governed, woken work assigned to
 * the right member with that member's stack injected.
 *
 * The two-step seam is deliberate and verified against upstream: create does NOT
 * auto-wake the assignee, so we always create() then requestWakeup() explicitly.
 */
import type { Actor, Hands, IdGen } from "../core/ports";
import type { DispatchRecord, Org, OrgMember, Task } from "../core/types";
import type { StackRegistry } from "../stacks/role-stacks";
import { resolveAdapterOverrides } from "../stacks/stack-injector";
import { memberForRole, resolveMember } from "../org/org";

export class NoMemberForRoleError extends Error {
  constructor(public readonly role: string) {
    super(`No org member is connected to role "${role}".`);
    this.name = "NoMemberForRoleError";
  }
}

export function routeTask(task: Task, org: Org): OrgMember {
  const member = memberForRole(org, task.role);
  if (!member) throw new NoMemberForRoleError(task.role);
  return member;
}

export interface DispatchDeps {
  hands: Hands;
  registry: StackRegistry;
  org: Org;
  newId: IdGen;
  ceoAgentId: string;
}

/**
 * Dispatch one task: resolve the member + stack, create the governed task with
 * the stack injected as adapter overrides, then explicitly wake the worker.
 */
export async function dispatchTask(
  task: Task,
  resolvedDepIssueIds: string[],
  deps: DispatchDeps,
): Promise<DispatchRecord> {
  // Solo-aware: a dedicated member if connected, else the CEO self-staffs the role.
  const member = resolveMember(deps.org, deps.registry, task.role);
  const stack = deps.registry.get(member.stackId);
  if (!stack) throw new Error(`Member ${member.agentId} references unknown stack ${member.stackId}`);

  const overrides = resolveAdapterOverrides(stack);
  const actor: Actor = { actorAgentId: deps.ceoAgentId };

  const issue = await deps.hands.createTask(
    {
      title: task.title,
      description: composeBrief(task),
      assigneeAgentId: member.agentId,
      goalId: deps.org.defaultGoalId,
      blockedByIssueIds: resolvedDepIssueIds.length ? resolvedDepIssueIds : undefined,
      priority: "medium",
      adapterOverrides: overrides,
      billingCode: `command-center:${task.id}`,
      originKind: "plugin:command-center:dispatch",
      originId: task.id,
    },
    actor,
  );

  const wake = await deps.hands.wakeTask(issue.id, {
    reason: "command-center:dispatch",
    idempotencyKey: `dispatch:${task.id}`,
    actorAgentId: deps.ceoAgentId,
  });

  return {
    taskId: task.id,
    issueId: issue.id,
    assigneeAgentId: member.agentId,
    role: member.role,
    stackId: stack.id,
    wakeupQueued: wake.queued,
  };
}

/** The brief the worker receives: task + how "done" is judged. */
function composeBrief(task: Task): string {
  return [
    task.description,
    "",
    "## Acceptance criteria",
    task.acceptanceCriteria,
    "",
    task.needsQA ? "_This deliverable will be verified by QA before it is accepted._" : "",
    "",
    "When done, post a comment with: what you did, how you verified it, and the artifact (diff/PR/link).",
  ]
    .filter(Boolean)
    .join("\n");
}
