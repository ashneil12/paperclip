/**
 * Domain model for the CEO command center. Pure data — no Paperclip imports.
 * The host layer (src/host) maps these onto Paperclip's issues/agents.
 */

/** A role in the org. Known roles are first-class; the type stays open so you can add more. */
export type RoleId =
  | "ceo"
  | "engineer"
  | "qa"
  | "researcher"
  | "marketer"
  | "designer"
  | (string & {});

/** How a worker runtime is driven. Mirrors Paperclip adapter kinds. */
export type AdapterKind = "claude" | "codex" | "cursor" | "http" | "generic";

/** Paperclip issue lifecycle status (mirrors the SDK shim's IssueLike["status"]). */
export type IssueLikeStatus =
  | "backlog" | "todo" | "in_progress" | "blocked" | "in_review" | "done" | "cancelled";

/**
 * A Role Stack (V3): the complete bundle that gets auto-injected when an agent
 * is connected to a role. "Connect a Claude Code as the CEO" -> the `ceo` stack
 * (OperatorOS persona + KB skill + operator tools) drops in automatically.
 */
export interface RoleStack {
  id: string;
  role: RoleId;
  displayName: string;
  /** The persona / system prompt that makes this member who they are. */
  persona: string;
  /** Skill bundles to mount for this role (by key). */
  skills: string[];
  /** Tool grants this role is allowed to use. */
  tools: string[];
  /** Preferred adapter + model for the bound agent. */
  adapterKind: AdapterKind;
  model: string;
  /** Memory policy: how much conversational/runtime memory this role keeps. */
  memory: { retainTurns: number; summarizeAfterTurns: number };
  /** Default autonomy posture for this role. */
  autonomy: AutonomyPosture;
}

export type AutonomyPosture = "act-then-report" | "ask-first" | "read-only";

/** A member of the org: a role filled by a bound agent, running a stack. */
export interface OrgMember {
  role: RoleId;
  title: string;
  /** Paperclip agent id this role is bound to (the "connected" agent). */
  agentId: string;
  /** The stack injected into that agent. */
  stackId: string;
  displayName: string;
}

export interface Org {
  companyId: string;
  /** Goal that dispatched work hangs under (goal ancestry / "the why"). */
  defaultGoalId?: string;
  members: OrgMember[];
  /**
   * Solo / self-staffing mode (default true). When a role has no dedicated member,
   * the CEO's own agent fills it, running that role's stack — so connecting ONE
   * Claude Code as CEO lets it plan AND execute every role. Set false to require an
   * explicit member per role.
   */
  soloFallback?: boolean;
}

/** What the operator asked the CEO to make happen. */
export interface Objective {
  id: string;
  text: string;
  conversationId: string;
  requestedBy: string;
}

export type TaskStatus = "planned" | "dispatched" | "running" | "in_review" | "done" | "failed" | "blocked" | "needs_human";

/** A unit of work the CEO decomposed out of an objective. */
export interface Task {
  id: string;
  title: string;
  description: string;
  /** Which role should execute it (drives stack injection + assignee). */
  role: RoleId;
  /** Task ids this depends on (become blockedBy issues). */
  dependsOn: string[];
  /** What "done" means — handed to the worker and to QA. */
  acceptanceCriteria: string;
  /** Whether the CEO must run the QA verify gate before declaring done (V2). */
  needsQA: boolean;
  status: TaskStatus;
}

/** The CEO's decomposition of an objective. */
export interface Plan {
  objectiveId: string;
  summary: string;
  rationale: string;
  tasks: Task[];
}

/** Record of a task dispatched through the governed seam. */
export interface DispatchRecord {
  taskId: string;
  issueId: string;
  assigneeAgentId: string;
  role: RoleId;
  stackId: string;
  wakeupQueued: boolean;
}

/** Outcome of a worker run, read back from issue comments. */
export interface TaskRunResult {
  taskId: string;
  issueId: string;
  status: "done" | "failed" | "blocked";
  resultSummary: string;
  artifacts?: string[];
}

/**
 * Verdict from the QA verify gate (V2). The gate runs two lanes:
 *  - `passed` is the AUTHORITATIVE result of the deterministic check (Playwright +
 *    @clerk/testing + toHaveScreenshot). It is the ONLY signal that blocks "done".
 *  - `advisory` carries the non-blocking Midscene AI lane — reported, never gates.
 */
export interface QAVerdict {
  taskId: string;
  qaIssueId: string;
  /** Authoritative deterministic-gate result. The only thing that blocks "done". */
  passed: boolean;
  /** Gate findings — one per acceptance criterion, with how it was proven. */
  findings: string[];
  /** Non-blocking notes from the Midscene advisory lane. Never flips `passed`. */
  advisory?: string[];
}

export type ConversationRole = "user" | "ceo" | "system";
export interface ConversationTurn {
  role: ConversationRole;
  text: string;
  ts: string;
}

/** A decision the CEO faces, classified for the autonomy gate. */
export interface Decision {
  description: string;
  reversible: boolean;
  /** True if it trips a Paperclip governance gate (budget ceiling, destructive scope, spend, approval). */
  governanceGated: boolean;
  estimatedSpendUsd?: number;
}

/** What the CEO does on a turn. Discriminated union. */
export type CeoAction =
  | { kind: "dispatch"; task: Task; dispatch: DispatchRecord }
  | { kind: "qa"; verdict: QAVerdict }
  | { kind: "report"; text: string }
  | { kind: "ask"; question: string; reason: string };

/**
 * Serializable state of an in-flight run. The host persists this to ctx.state
 * between /chat/poll ticks so the loop is resumable without blocking a request.
 */
export interface RunState {
  conversationId: string;
  objectiveText: string;
  plan: Plan;
  /** taskId -> dispatched issue id. */
  dispatched: Record<string, string>;
  /** taskId -> terminal result. */
  results: Record<string, TaskRunResult>;
  /** taskId -> QA verdict. */
  verdicts: Record<string, QAVerdict>;
  /** taskId -> spawned QA issue id. */
  qaIssues: Record<string, string>;
  /** taskId -> count of QA-fail auto-rework attempts spent (V2.1 self-healing gate). */
  reworks?: Record<string, number>;
  /** taskId -> rework brief appended to the next dispatch (the QA findings to fix). */
  reworkNotes?: Record<string, string>;
  /** Tasks held at the autonomy gate. */
  gated: Array<{ taskId: string; reason: string }>;
  awaitingHuman: boolean;
  done: boolean;
}

/** Rough estimated spend for a run (not a billing source of truth). */
export interface SpendBreakdown {
  totalUsd: number;
  byRole: Record<string, number>;
  runs: number;
}

/** The CEO's reply for one operator message. */
export interface CeoReply {
  conversationId: string;
  text: string;
  plan?: Plan;
  actions: CeoAction[];
  /** True if the loop paused for the human (governance gate). */
  awaitingHuman: boolean;
  /** Rough estimated spend for this run. */
  spend?: SpendBreakdown;
}
