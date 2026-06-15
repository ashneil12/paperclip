/**
 * Paperclip plugin manifest (PLUGIN_SPEC §10.1). Additive: a page slot for the
 * chat surface + JSON API routes for the CEO brain. No core edits. The CEO
 * persona ships as a managed skill so the host can mount it.
 */
import type { PaperclipPluginManifestV1 } from "../sdk";
import { CEO_SYSTEM_PROMPT } from "../stacks/operatoros-stack";

export const manifest: PaperclipPluginManifestV1 = {
  id: "@ash/command-center",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Command Center",
  description:
    "A chatable CEO that decomposes objectives, dispatches them to your agent fleet under Paperclip's budgets + audit, auto-injects per-role stacks (OperatorOS for the CEO), and verifies its own work before declaring done.",
  author: "Ash",
  categories: ["automation", "ui"],
  minimumHostVersion: "2026.6.0",
  capabilities: [
    "issues.read",
    "issues.create",
    "issues.update",
    "issues.wakeup",
    "issue.comments.read",
    "issue.comments.create",
    "issue.interactions.create",
    "skills.managed",
  ],
  entrypoints: { worker: "./dist/host/worker.js", ui: "./dist/ui/" },
  instanceConfigSchema: {
    type: "object",
    properties: {
      defaultGoalId: { type: "string", description: "Goal that all dispatched work hangs under (ancestry)." },
      roster: {
        type: "array",
        description: "Which agent fills which role. The CEO seat auto-injects OperatorOS.",
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
    { routeKey: "chat", method: "POST", path: "/chat", capabilities: ["issues.create", "issues.wakeup", "issue.comments.create"] },
    { routeKey: "poll", method: "GET", path: "/poll", capabilities: ["issues.read", "issue.comments.read"] },
    { routeKey: "roster", method: "GET", path: "/roster" },
    // Autonomous backlog loop (standing objectives the CEO works while you sleep).
    { routeKey: "enqueue", method: "POST", path: "/enqueue" },
    { routeKey: "backlog", method: "GET", path: "/backlog" },
    { routeKey: "tick", method: "POST", path: "/tick", capabilities: ["issues.create", "issues.wakeup", "issue.comments.create"] },
    { routeKey: "briefing", method: "GET", path: "/briefing" },
  ],
  skills: [
    {
      key: "command-center-ceo",
      displayName: "Command Center CEO",
      description: "OperatorOS persona + the dispatch/verify/report protocol for the CEO seat.",
      body: CEO_SYSTEM_PROMPT,
    },
  ],
  ui: {
    slots: [
      { type: "page", id: "command-center", displayName: "Command Center", exportName: "CommandCenterPage", routePath: "command-center" },
    ],
  },
};

export default manifest;
