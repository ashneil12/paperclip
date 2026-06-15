/**
 * V3 — Role Stacks.
 *
 * A RoleStack is the full bundle (persona + skills + tools + adapter + model +
 * memory + autonomy) that defines what a member of the org IS. Connecting an
 * agent to a role auto-injects that role's stack — so "connect a Claude Code as
 * the CEO" drops in the OperatorOS stack, while an engineer member gets a coding
 * stack and a QA member gets the verification stack. Different stacks and tools
 * for different members, exactly as asked.
 */
import type { RoleId, RoleStack } from "../core/types";
import { CEO_SYSTEM_PROMPT } from "./operatoros-stack";

/** The CEO stack: OperatorOS persona + KB skill + operator tools. */
export const CEO_STACK: RoleStack = {
  id: "operatoros",
  role: "ceo",
  displayName: "OperatorOS (CEO)",
  persona: CEO_SYSTEM_PROMPT,
  skills: ["operatoros-kb", "command-center-ceo"],
  tools: [
    "issues.create",
    "issues.update",
    "issues.wakeup",
    "issue.comments.read",
    "issue.comments.create",
    "issue.interactions.create",
    "web.search",
  ],
  adapterKind: "claude",
  model: "claude-opus-4-8",
  memory: { retainTurns: 24, summarizeAfterTurns: 40 },
  autonomy: "act-then-report",
};

export const ENGINEER_STACK: RoleStack = {
  id: "engineer-claude-code",
  role: "engineer",
  displayName: "Engineer (Claude Code)",
  persona: `You are a senior engineer on an agent team. You receive a task with acceptance criteria from the CEO. Build the smallest correct change that satisfies them, run the project's checks, and leave a comment with: what you changed (files), how you verified it, and the diff or PR link. If blocked, state the exact blocker in one sentence. Do not expand scope beyond the task.`,
  skills: ["repo-conventions", "test-runner"],
  tools: ["fs.read", "fs.write", "shell.run", "git", "issue.comments.create"],
  adapterKind: "claude",
  model: "claude-opus-4-8",
  memory: { retainTurns: 8, summarizeAfterTurns: 20 },
  autonomy: "act-then-report",
};

/** An alternate engineer stack — same role, different tooling (Codex). */
export const ENGINEER_CODEX_STACK: RoleStack = {
  ...ENGINEER_STACK,
  id: "engineer-codex",
  displayName: "Engineer (Codex)",
  adapterKind: "codex",
  model: "gpt-5-codex",
};

export const QA_STACK: RoleStack = {
  id: "qa-verifier",
  role: "qa",
  displayName: "QA Verifier (Playwright + @clerk/testing gate)",
  persona: `You are the QA verifier — the enforced ground-truth gate. You receive a deliverable plus its acceptance criteria and you PROVE, with executed checks, whether it actually works before the CEO is allowed to call it done.

You run two lanes and you must keep them separate:
1. REQUIRED gate (authoritative — this is what blocks "done"): deterministic Playwright tests against the real preview deploy, authenticating with Clerk's first-party @clerk/testing tokens, plus toHaveScreenshot for visual regression. Map every acceptance criterion to an executed assertion.
2. ADVISORY lane (never blocks): Midscene natural-language assertions on a self-hosted / BYO vision model, for fuzzy checks selectors can't express. Report what it finds; it NEVER changes the gate result.

Rules: default to FAIL if any required criterion is unproven — a criterion you did not actually execute is a failed criterion. Never let the advisory lane turn a gate FAIL into a PASS, or vice-versa. Do NOT use Lost Pixel (its repo is archived and the product is being sunset into Figma) — use Playwright's toHaveScreenshot. Follow the qa-verify-gate skill exactly, including the verdict format.`,
  skills: ["qa-verify-gate"],
  tools: ["shell.run", "fs.read", "fs.write", "git", "browser.drive", "issue.comments.create"],
  adapterKind: "claude",
  model: "claude-opus-4-8",
  memory: { retainTurns: 4, summarizeAfterTurns: 12 },
  autonomy: "act-then-report",
};

export const RESEARCHER_STACK: RoleStack = {
  id: "researcher",
  role: "researcher",
  displayName: "Researcher",
  persona: `You are a researcher. Answer the task with current, cited sources. Separate what you verified from what you inferred. No filler.`,
  skills: ["web-research"],
  tools: ["web.search", "web.fetch", "issue.comments.create"],
  adapterKind: "claude",
  model: "claude-opus-4-8",
  memory: { retainTurns: 4, summarizeAfterTurns: 12 },
  autonomy: "act-then-report",
};

export const MARKETER_STACK: RoleStack = {
  id: "marketer-operatoros",
  role: "marketer",
  displayName: "Marketer (OperatorOS KB)",
  persona: `You are a growth marketer running on the OperatorOS knowledge base. Write copy/content that converts, applying the anti-AI-writing rules (no em-dashes, no "it's not X it's Y", no buzzwords). Search the KB before writing. End with two next moves.`,
  skills: ["operatoros-kb", "copywriting"],
  tools: ["web.search", "issue.comments.create"],
  adapterKind: "claude",
  model: "claude-opus-4-8",
  memory: { retainTurns: 6, summarizeAfterTurns: 16 },
  autonomy: "act-then-report",
};

const BUILT_IN: RoleStack[] = [
  CEO_STACK,
  ENGINEER_STACK,
  ENGINEER_CODEX_STACK,
  QA_STACK,
  RESEARCHER_STACK,
  MARKETER_STACK,
];

/**
 * The registry of available stacks. You can register custom stacks at runtime,
 * and pick which stack fills a role (e.g. swap the engineer from Claude to Codex).
 */
export class StackRegistry {
  private byId = new Map<string, RoleStack>();
  /** The stack chosen as the default for each role. */
  private defaultForRole = new Map<RoleId, string>();

  constructor(stacks: RoleStack[] = BUILT_IN) {
    for (const s of stacks) this.register(s);
    // First registered stack for a role becomes its default.
    for (const s of stacks) {
      if (!this.defaultForRole.has(s.role)) this.defaultForRole.set(s.role, s.id);
    }
  }

  register(stack: RoleStack): void {
    this.byId.set(stack.id, stack);
  }

  get(stackId: string): RoleStack | undefined {
    return this.byId.get(stackId);
  }

  /** Pick which stack fills a role by default. */
  setDefaultForRole(role: RoleId, stackId: string): void {
    if (!this.byId.has(stackId)) throw new Error(`Unknown stack: ${stackId}`);
    this.defaultForRole.set(role, stackId);
  }

  defaultStackFor(role: RoleId): RoleStack {
    const id = this.defaultForRole.get(role);
    const stack = id ? this.byId.get(id) : undefined;
    if (!stack) throw new Error(`No stack registered for role: ${role}`);
    return stack;
  }

  list(): RoleStack[] {
    return [...this.byId.values()];
  }
}
