/**
 * Ports — the small interfaces the CEO brain depends on. The Paperclip host
 * implements them over `ctx.issues` etc.; the test harness implements them with
 * in-memory fakes. This is what lets V0–V3 be fully testable without standing up
 * Postgres or the Paperclip server.
 */
import type { ConversationTurn, IssueLikeStatus } from "./types";

// Re-export the host issue status union under a domain name (kept in sync with the SDK shim).
export type { IssueLikeStatus };

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

/** Injectable clock so planning/dispatch is deterministic in tests. */
export interface Clock {
  now(): number;
  iso(): string;
}

/** Injectable id generator (deterministic counter in tests, uuid in prod). */
export type IdGen = (prefix: string) => string;

// --- LLM port -------------------------------------------------------------
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}
export interface LlmRequest {
  system?: string;
  messages: LlmMessage[];
  model?: string;
  /** Stack identity for logging/telemetry. */
  stackId?: string;
}
export interface LlmJsonRequest<T> extends LlmRequest {
  /** JSON schema the completion must satisfy. */
  schema: Record<string, unknown>;
  /** Coerce/validate the raw model output into T. Throws on invalid. */
  parse: (raw: unknown) => T;
}
export interface LLM {
  complete(input: LlmRequest): Promise<string>;
  completeJSON<T>(input: LlmJsonRequest<T>): Promise<T>;
}

// --- Hands port: the governed control plane (subset of PluginIssuesClient) -
export interface HandsIssue {
  id: string;
  status: IssueLikeStatus;
  assigneeAgentId?: string | null;
  title: string;
}
export interface HandsComment {
  id: string;
  body: string;
  authorAgentId?: string | null;
  authorKind?: "agent" | "user" | "plugin" | "system";
  createdAt: string;
}
/** Resolved stack overrides applied to a dispatched task (V3 injection point). */
export interface AdapterOverrides {
  adapterKind?: string;
  model?: string;
  systemPromptAppend?: string;
  toolAllowlist?: string[];
  skills?: string[];
}
export interface CreateTaskInput {
  title: string;
  description: string;
  assigneeAgentId: string;
  goalId?: string;
  parentId?: string;
  blockedByIssueIds?: string[];
  priority?: "low" | "medium" | "high" | "urgent";
  /** The injected role stack travels with the task. */
  adapterOverrides?: AdapterOverrides;
  billingCode?: string;
  originKind?: string;
  originId?: string;
}
export interface Actor {
  actorAgentId?: string | null;
  actorUserId?: string | null;
  actorRunId?: string | null;
}
/**
 * The governed verbs. Every CEO action goes through here — never raw DB writes —
 * which is what buys audit + budget + checkout + approvals for free.
 */
export interface Hands {
  createTask(input: CreateTaskInput, actor: Actor): Promise<HandsIssue>;
  /** EXPLICIT — create does NOT auto-wake the assignee (verified in upstream). */
  wakeTask(issueId: string, opts: { reason?: string; idempotencyKey?: string } & Actor): Promise<{ queued: boolean }>;
  getTask(issueId: string): Promise<HandsIssue | null>;
  updateTaskStatus(issueId: string, status: IssueLikeStatus, actor: Actor): Promise<HandsIssue>;
  listComments(issueId: string): Promise<HandsComment[]>;
  addComment(issueId: string, body: string, opts?: { authorAgentId?: string }): Promise<HandsComment>;
  /** The "ask Ash" escape hatch — used sparingly, only on governance gates. */
  askHuman(issueId: string, prompt: string, actor: Actor): Promise<void>;
}

// --- Memory port (V1) -----------------------------------------------------
export interface ConversationMemory {
  conversationId: string;
  turns: ConversationTurn[];
  /** Rolling summary of older turns (compaction). */
  summary: string;
}
export interface MemoryStore {
  load(conversationId: string): Promise<ConversationMemory>;
  save(memory: ConversationMemory): Promise<void>;
}

// --- Event sink (V1 streaming / report-back) ------------------------------
export type CcEvent =
  | { type: "ceo.thinking"; text: string }
  | { type: "ceo.plan"; summary: string; taskCount: number }
  | { type: "task.dispatched"; taskId: string; issueId: string; role: string }
  | { type: "task.progress"; taskId: string; text: string }
  | { type: "task.result"; taskId: string; status: string; summary: string }
  | { type: "qa.verdict"; taskId: string; passed: boolean }
  | { type: "ceo.report"; text: string }
  | { type: "ceo.awaiting_human"; question: string };
export interface EventSink {
  emit(event: CcEvent): void;
}
