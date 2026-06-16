/**
 * Paperclip plugin manifest. Additive: a page slot for the chat surface + JSON API
 * routes for the CEO brain. Validated against the real host schema (PLUGIN_SPEC +
 * packages/shared validators): lowercase id, routes carry `auth` + the
 * `api.routes.register` capability, `plugin.state.*` for ctx.state, `ui.page.register`
 * for the page slot. The CEO persona is injected via the role stack, not declared as
 * a managed skill, so no `skills` block is needed.
 */
import type { PaperclipPluginManifestV1 } from "../sdk";

export const manifest: PaperclipPluginManifestV1 = {
  id: "command-center",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Command Center",
  description:
    "A chatable CEO that decomposes objectives, dispatches them to your agent fleet under Paperclip's budgets + audit, auto-injects per-role stacks (OperatorOS for the CEO), and verifies its own work before declaring done.",
  author: "Ash",
  categories: ["automation", "ui"],
  capabilities: [
    "api.routes.register",
    "ui.page.register",
    "ui.sidebar.register",
    "plugin.state.read",
    "plugin.state.write",
    "agents.read",
    "issues.read",
    "issues.create",
    "issues.update",
    "issues.wakeup",
    "issue.comments.read",
    "issue.comments.create",
    "issue.interactions.create",
  ],
  entrypoints: { worker: "./dist/host/worker.js", ui: "./dist/ui" },
  instanceConfigSchema: {
    type: "object",
    properties: {
      defaultGoalId: { type: "string", description: "Goal that all dispatched work hangs under (ancestry)." },
      roster: {
        type: "array",
        description: "Which agent fills which role. The CEO seat auto-injects OperatorOS; solo mode self-staffs the rest.",
        items: {
          type: "object",
          required: ["role", "agentId"],
          properties: {
            role: { type: "string", description: "ceo | engineer | qa | researcher | marketer | designer" },
            agentId: { type: "string", description: "Paperclip agent id bound to this role." },
            stackId: { type: "string", description: "Optional: override the role's default stack (e.g. engineer-codex)." },
          },
        },
      },
    },
  },
  apiRoutes: [
    { routeKey: "chat", method: "POST", path: "/chat", auth: "board", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "poll", method: "GET", path: "/poll", auth: "board", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
    { routeKey: "roster", method: "GET", path: "/roster", auth: "board", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
    // Autonomous backlog loop (standing objectives the CEO works while you sleep).
    { routeKey: "enqueue", method: "POST", path: "/enqueue", auth: "board", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "backlog", method: "GET", path: "/backlog", auth: "board", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
    { routeKey: "tick", method: "POST", path: "/tick", auth: "board", capability: "api.routes.register", companyResolution: { from: "body", key: "companyId" } },
    { routeKey: "briefing", method: "GET", path: "/briefing", auth: "board", capability: "api.routes.register", companyResolution: { from: "query", key: "companyId" } },
  ],
  ui: {
    // Sidebar nav entry so the page is discoverable (a `page` slot alone has no link).
    launchers: [
      {
        id: "command-center-nav",
        displayName: "Command Center",
        description: "Chat with your CEO",
        placementZone: "sidebar",
        action: { type: "navigate", target: "command-center" },
      },
    ],
    slots: [
      { type: "page", id: "command-center", displayName: "Command Center", exportName: "CommandCenterPage", routePath: "command-center" },
    ],
  },
};

export default manifest;
