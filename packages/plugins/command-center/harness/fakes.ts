/**
 * In-memory fakes that stand in for the Paperclip host so the full CEO loop runs
 * (and is asserted) without Postgres or the server. FakeHands models the issue
 * lifecycle + the workers: when the CEO wakes a task, the assigned "worker"
 * does its job, posts a result comment, and flips the issue terminal — exactly
 * the report-back the real heartbeat produces, just synchronous.
 */
import type {
  Actor,
  Clock,
  CreateTaskInput,
  Hands,
  HandsComment,
  HandsIssue,
  IdGen,
  LLM,
  LlmJsonRequest,
  LlmRequest,
  IssueLikeStatus,
} from "../src/core/ports";

interface StoredIssue {
  id: string;
  title: string;
  description: string;
  status: IssueLikeStatus;
  assigneeAgentId?: string | null;
  originKind?: string;
  originId?: string;
  blockedBy: string[];
  overrides?: CreateTaskInput["adapterOverrides"];
}

export interface FakeHandsConfig {
  /** Global QA verdict the fake QA worker returns. */
  qa?: "pass" | "fail";
  /** Fail the FIRST N QA verdicts, then pass — to exercise the auto-rework loop. */
  qaFailFirst?: number;
  /** originIds whose worker should report `failed` instead of `done`. */
  failTasks?: Set<string>;
}

export interface AskRecord {
  issueId: string;
  prompt: string;
}

export class FakeHands implements Hands {
  readonly issues = new Map<string, StoredIssue>();
  readonly comments = new Map<string, HandsComment[]>();
  readonly wakeups: string[] = [];
  readonly asks: AskRecord[] = [];
  private qaRuns = 0;

  constructor(
    private readonly newId: IdGen,
    private readonly clock: Clock,
    private readonly config: FakeHandsConfig = { qa: "pass" },
  ) {}

  async createTask(input: CreateTaskInput, _actor: Actor): Promise<HandsIssue> {
    const id = this.newId("issue");
    const issue: StoredIssue = {
      id,
      title: input.title,
      description: input.description,
      status: "todo",
      assigneeAgentId: input.assigneeAgentId,
      originKind: input.originKind,
      originId: input.originId,
      blockedBy: input.blockedByIssueIds ?? [],
      overrides: input.adapterOverrides ?? undefined,
    };
    this.issues.set(id, issue);
    this.comments.set(id, []);
    return this.view(issue);
  }

  async wakeTask(issueId: string, _opts: { reason?: string; idempotencyKey?: string } & Actor): Promise<{ queued: boolean }> {
    this.wakeups.push(issueId);
    const issue = this.issues.get(issueId);
    if (!issue) return { queued: false };
    // Run the worker assigned to this issue.
    this.runWorker(issue);
    return { queued: true };
  }

  async getTask(issueId: string): Promise<HandsIssue | null> {
    const issue = this.issues.get(issueId);
    return issue ? this.view(issue) : null;
  }

  async updateTaskStatus(issueId: string, status: IssueLikeStatus, _actor: Actor): Promise<HandsIssue> {
    const issue = this.issues.get(issueId);
    if (!issue) throw new Error(`No such issue: ${issueId}`);
    issue.status = status;
    return this.view(issue);
  }

  async listComments(issueId: string): Promise<HandsComment[]> {
    return [...(this.comments.get(issueId) ?? [])];
  }

  async addComment(issueId: string, body: string, opts?: { authorAgentId?: string }): Promise<HandsComment> {
    const comment: HandsComment = {
      id: this.newId("comment"),
      body,
      authorAgentId: opts?.authorAgentId ?? null,
      authorKind: opts?.authorAgentId ? "agent" : "plugin",
      createdAt: this.clock.iso(),
    };
    this.comments.get(issueId)?.push(comment);
    return comment;
  }

  async askHuman(issueId: string, prompt: string, _actor: Actor): Promise<void> {
    this.asks.push({ issueId, prompt });
  }

  // --- worker simulation -------------------------------------------------
  private runWorker(issue: StoredIssue): void {
    const kind = issue.originKind ?? "";
    if (kind.endsWith(":qa")) {
      this.qaRuns += 1;
      const failFirst = this.config.qaFailFirst ?? 0;
      const pass = failFirst > 0 ? this.qaRuns > failFirst : (this.config.qa ?? "pass") === "pass";
      this.post(issue, issue.assigneeAgentId, pass ? "VERDICT: PASS\n- All acceptance criteria verified against the running app." : "VERDICT: FAIL\n- Criterion 2 not satisfied: empty-state copy missing.");
      issue.status = "done";
      return;
    }
    // Normal dispatch worker.
    const fail = issue.originId ? this.config.failTasks?.has(issue.originId) : false;
    if (fail) {
      this.post(issue, issue.assigneeAgentId, `Could not complete "${issue.title}": dependency unavailable.`);
      issue.status = "cancelled"; // Paperclip has no "failed" issue status; cancelled is the terminal failure state.
      return;
    }
    const stackNote = issue.overrides ? ` [stack: ${issue.overrides.adapterKind}/${issue.overrides.model}]` : "";
    this.post(
      issue,
      issue.assigneeAgentId,
      `Done: ${issue.title}.${stackNote} Verified locally; checks green. Artifact: PR #${issue.id.slice(-4)}.`,
    );
    issue.status = "done";
  }

  private post(issue: StoredIssue, agentId: string | null | undefined, body: string): void {
    this.comments.get(issue.id)?.push({
      id: this.newId("comment"),
      body,
      authorAgentId: agentId ?? null,
      authorKind: "agent",
      createdAt: this.clock.iso(),
    });
  }

  private view(issue: StoredIssue): HandsIssue {
    return { id: issue.id, status: issue.status, assigneeAgentId: issue.assigneeAgentId, title: issue.title };
  }
}

// --- deterministic clock + id gen -----------------------------------------
export function makeFakeClock(): Clock {
  let t = 0;
  return {
    now: () => ++t,
    iso: () => `2026-06-16T00:00:${String(t++).padStart(2, "0")}.000Z`,
  };
}

export function makeFakeIdGen(): IdGen {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_${n}`;
  };
}

/** No-op monitor for tests: workers complete on wake, so the first poll succeeds. */
export const instantMonitor = { maxPolls: 3, sleep: async () => {} };

// --- scripted LLM (tests the model planning path deterministically) -------
export class ScriptedLLM implements LLM {
  constructor(private readonly plan: unknown, private readonly text = "ok") {}
  async complete(_input: LlmRequest): Promise<string> {
    return this.text;
  }
  async completeJSON<T>(input: LlmJsonRequest<T>): Promise<T> {
    return input.parse(this.plan);
  }
}
