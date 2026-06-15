/**
 * Hands implemented over Paperclip's PluginIssuesClient. This is the entire
 * binding between the CEO's governed verbs and the real control plane: every
 * action becomes a budgeted, checked-out, audited issue mutation. Note create()
 * then explicit requestWakeup() — create does NOT auto-wake (verified upstream).
 */
import type { IssueAssigneeAdapterOverrides, PluginIssuesClient, IssueLike } from "../sdk";
import type { Actor, CreateTaskInput, Hands, HandsComment, HandsIssue } from "../core/ports";
import type { IssueLikeStatus } from "../core/types";

export class PaperclipHands implements Hands {
  constructor(private readonly issues: PluginIssuesClient, private readonly companyId: string) {}

  async createTask(input: CreateTaskInput, actor: Actor): Promise<HandsIssue> {
    const issue = await this.issues.create({
      companyId: this.companyId,
      goalId: input.goalId,
      parentId: input.parentId,
      title: input.title,
      description: input.description,
      status: "todo",
      priority: input.priority ?? "medium",
      assigneeAgentId: input.assigneeAgentId,
      blockedByIssueIds: input.blockedByIssueIds,
      billingCode: input.billingCode ?? null,
      assigneeAdapterOverrides: input.adapterOverrides as IssueAssigneeAdapterOverrides | null | undefined,
      originKind: input.originKind,
      originId: input.originId ?? null,
      actor: toMutationActor(actor),
    });
    return view(issue);
  }

  async wakeTask(issueId: string, opts: { reason?: string; idempotencyKey?: string } & Actor): Promise<{ queued: boolean }> {
    const res = await this.issues.requestWakeup(issueId, this.companyId, {
      reason: opts.reason,
      idempotencyKey: opts.idempotencyKey ?? null,
      ...toMutationActor(opts),
    });
    return { queued: res.queued };
  }

  async getTask(issueId: string): Promise<HandsIssue | null> {
    const issue = await this.issues.get(issueId, this.companyId);
    return issue ? view(issue) : null;
  }

  async updateTaskStatus(issueId: string, status: IssueLikeStatus, actor: Actor): Promise<HandsIssue> {
    const issue = await this.issues.update(issueId, { status }, this.companyId, toMutationActor(actor));
    return view(issue);
  }

  async listComments(issueId: string): Promise<HandsComment[]> {
    const comments = await this.issues.listComments(issueId, this.companyId);
    return comments.map((c) => ({
      id: c.id,
      body: c.body,
      authorAgentId: c.authorAgentId,
      authorKind: c.authorKind,
      createdAt: c.createdAt,
    }));
  }

  async addComment(issueId: string, body: string, opts?: { authorAgentId?: string }): Promise<HandsComment> {
    const c = await this.issues.createComment(issueId, body, this.companyId, opts);
    return { id: c.id, body: c.body, authorAgentId: c.authorAgentId, authorKind: c.authorKind, createdAt: c.createdAt };
  }

  async askHuman(issueId: string, prompt: string, _actor: Actor): Promise<void> {
    await this.issues.createInteraction(issueId, { kind: "request_confirmation", prompt }, this.companyId);
  }
}

function view(issue: IssueLike): HandsIssue {
  return { id: issue.id, status: issue.status, assigneeAgentId: issue.assigneeAgentId, title: issue.title };
}

function toMutationActor(actor: Actor) {
  return { actorAgentId: actor.actorAgentId ?? null, actorUserId: actor.actorUserId ?? null, actorRunId: actor.actorRunId ?? null };
}
