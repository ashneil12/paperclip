/**
 * Faithful, minimal mirror of `@paperclipai/plugin-sdk` — only the surface this
 * plugin uses. When this package is dropped in-tree under
 * `paperclip/packages/plugins/command-center`, delete this file and depend on
 * `@paperclipai/plugin-sdk` (workspace:*) instead; the named exports line up.
 *
 * Source of truth (verified against the cloned upstream repo, branch master):
 *  - packages/plugins/sdk/src/define-plugin.ts  (PluginDefinition, PluginApiRequestInput, PluginApiResponse)
 *  - packages/plugins/sdk/src/types.ts          (PluginContext, PluginIssuesClient)
 *  - doc/plugins/PLUGIN_SPEC.md §10.1           (PaperclipPluginManifestV1)
 */

// --- Manifest (PLUGIN_SPEC §10.1) -----------------------------------------
export type JsonSchema = Record<string, unknown>;

export interface PaperclipPluginManifestV1 {
  id: string;
  apiVersion: 1;
  version: string;
  displayName: string;
  description: string;
  author: string;
  categories: Array<"connector" | "workspace" | "automation" | "ui">;
  minimumHostVersion?: string;
  capabilities: string[];
  entrypoints: { worker: string; ui?: string };
  instanceConfigSchema?: JsonSchema;
  tools?: Array<{ name: string; displayName: string; description: string; parametersSchema: JsonSchema }>;
  apiRoutes?: PluginApiRouteDeclaration[];
  agents?: PluginManagedAgentDeclaration[];
  skills?: PluginManagedSkillDeclaration[];
  ui?: {
    launchers?: Array<{
      id: string;
      displayName: string;
      description?: string;
      placementZone: string;
      exportName?: string;
      entityTypes?: string[];
      order?: number;
      action: { type: string; target: string; params?: Record<string, unknown> };
      render?: unknown;
    }>;
    slots: Array<{
      type:
        | "page" | "detailTab" | "taskDetailView" | "dashboardWidget" | "sidebar"
        | "routeSidebar" | "sidebarPanel" | "projectSidebarItem" | "globalToolbarButton"
        | "toolbarButton" | "contextMenuItem" | "commentAnnotation" | "commentContextMenuItem"
        | "settingsPage" | "companySettingsPage";
      id: string;
      displayName: string;
      exportName: string;
      entityTypes?: Array<"project" | "issue" | "agent" | "goal" | "run">;
      routePath?: string;
    }>;
  };
}

export interface PluginApiRouteDeclaration {
  routeKey: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string; // e.g. "/chat" or "/issues/:issueId/smoke"
  auth: "board" | "agent" | "board-or-agent" | "webhook";
  capability: "api.routes.register";
  checkoutPolicy?: "none" | "required-for-agent-in-progress" | "always-for-agent";
  companyResolution?: { from: "body" | "query"; key: string } | { from: "issue"; param: string };
}
export interface PluginManagedAgentDeclaration {
  key: string;
  displayName: string;
  adapterKind?: string;
  defaultModel?: string;
  systemPrompt?: string;
}
export interface PluginManagedSkillDeclaration {
  key: string;
  displayName: string;
  description?: string;
  body?: string;
}

// --- Issues client (types.ts:1330) ----------------------------------------
export interface IssueLike {
  id: string;
  companyId: string;
  goalId?: string | null;
  parentId?: string | null;
  title: string;
  description?: string | null;
  status: "backlog" | "todo" | "in_progress" | "blocked" | "in_review" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  assigneeAgentId?: string | null;
}
export interface IssueCommentLike {
  id: string;
  issueId: string;
  body: string;
  authorAgentId?: string | null;
  authorKind?: "agent" | "user" | "plugin" | "system";
  createdAt: string;
}
export interface IssueAssigneeAdapterOverrides {
  adapterKind?: string;
  model?: string;
  systemPromptAppend?: string;
  toolAllowlist?: string[];
  skills?: string[];
  [key: string]: unknown;
}
export interface PluginIssueMutationActor {
  actorAgentId?: string | null;
  actorUserId?: string | null;
  actorRunId?: string | null;
}
export interface PluginIssuesClient {
  list(input: { companyId: string; status?: IssueLike["status"]; assigneeAgentId?: string; limit?: number }): Promise<IssueLike[]>;
  get(issueId: string, companyId: string): Promise<IssueLike | null>;
  create(input: {
    companyId: string;
    goalId?: string;
    parentId?: string;
    title: string;
    description?: string;
    status?: IssueLike["status"];
    priority?: IssueLike["priority"];
    assigneeAgentId?: string;
    blockedByIssueIds?: string[];
    billingCode?: string | null;
    assigneeAdapterOverrides?: IssueAssigneeAdapterOverrides | null;
    originKind?: string;
    originId?: string | null;
    actor?: PluginIssueMutationActor;
  }): Promise<IssueLike>;
  update(issueId: string, patch: Partial<Pick<IssueLike, "title" | "description" | "status" | "priority" | "assigneeAgentId">>, companyId: string, actor?: PluginIssueMutationActor): Promise<IssueLike>;
  requestWakeup(issueId: string, companyId: string, options?: { reason?: string; contextSource?: string; idempotencyKey?: string | null } & PluginIssueMutationActor): Promise<{ queued: boolean }>;
  listComments(issueId: string, companyId: string): Promise<IssueCommentLike[]>;
  createComment(issueId: string, body: string, companyId: string, options?: { authorAgentId?: string }): Promise<IssueCommentLike>;
  createInteraction(issueId: string, interaction: { kind: "request_confirmation" | "ask_user_questions"; prompt: string; options?: unknown }, companyId: string, options?: { authorAgentId?: string }): Promise<{ id: string }>;
}

// --- Plugin context (types.ts) --------------------------------------------
export interface PluginLogger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}
export interface PluginScopeKey {
  scopeKind: string;
  scopeId: string;
  stateKey: string;
  namespace?: string;
}
export interface PluginStateClient {
  get(input: PluginScopeKey): Promise<unknown>;
  /** value is a SEPARATE second argument (matches the real SDK). */
  set(input: PluginScopeKey, value: unknown): Promise<void>;
  delete(input: PluginScopeKey): Promise<void>;
}
export interface PluginAgentLike {
  id: string;
  name?: string;
  status?: string;
  adapterType?: string;
}
export interface PluginAgentsClient {
  list(input: { companyId: string; status?: string; limit?: number; offset?: number }): Promise<PluginAgentLike[]>;
  get(agentId: string, companyId: string): Promise<PluginAgentLike | null>;
}
export interface PluginContext {
  manifest: PaperclipPluginManifestV1;
  logger: PluginLogger;
  issues: PluginIssuesClient;
  agents: PluginAgentsClient;
  state: PluginStateClient;
  config: { get(): Promise<Record<string, unknown>> };
  secrets: { resolve(ref: string): Promise<string> };
  data: { register(key: string, handler: (params: Record<string, unknown>) => Promise<unknown>): void };
  actions: { register(key: string, handler: (params: Record<string, unknown>) => Promise<unknown>): void };
}

// --- Worker entry (define-plugin.ts) --------------------------------------
export interface PluginApiRequestInput {
  routeKey: string;
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  body: unknown;
  actor: { actorType: "user" | "agent"; actorId: string; agentId?: string | null; userId?: string | null; runId?: string | null };
  companyId: string;
  headers: Record<string, string>;
}
export interface PluginApiResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface PluginHealthDiagnostics {
  status: "ok" | "degraded" | "error";
  message?: string;
  details?: Record<string, unknown>;
}
export interface PluginDefinition {
  setup(ctx: PluginContext): Promise<void>;
  onApiRequest?(input: PluginApiRequestInput): Promise<PluginApiResponse>;
  onHealth?(): Promise<PluginHealthDiagnostics>;
}

/** Mirrors the real SDK: wrap the definition as a PaperclipPlugin (`{ definition }`).
 * runWorker reads `plugin.definition.setup`, so the wrapper is load-bearing. */
export function definePlugin(def: PluginDefinition): { definition: PluginDefinition } {
  return { definition: def };
}
export function runWorker(plugin: PluginDefinition, entryUrl: string): void {
  // In-tree: hand off to the REAL host SDK at runtime. A non-literal specifier keeps
  // the typecheck graph self-contained (no need to build the SDK to typecheck this
  // plugin); esbuild leaves it external and Node resolves it from the monorepo
  // node_modules when the host boots the worker. The plugin's structural shapes are
  // compatible with the real host objects on every field this plugin reads.
  const spec = "@paperclipai/plugin-sdk";
  void (import(spec) as Promise<{ runWorker(p: unknown, u: string): unknown }>).then((real) =>
    real.runWorker(plugin, entryUrl),
  );
}
