/**
 * Lightweight spend awareness. You run multiple CC/Codex subscriptions and burn
 * through them — so the CEO should know roughly what a run costs and report it.
 *
 * This is a rough estimate derived from what was dispatched (one worker run per
 * dispatched task + per QA task), priced by the assigned stack's model. It is NOT
 * a billing source of truth — Paperclip's own cost_events are — but it's enough for
 * the CEO to surface "this objective cost ~$X, mostly on engineering" and to keep
 * you oriented. The hard spend ceiling lives in the autonomy gate.
 */
import type { Org, RoleId, RunState, SpendBreakdown } from "../core/types";
import type { StackRegistry } from "../stacks/role-stacks";
import { resolveMember } from "../org/org";

export type { SpendBreakdown };

/** Rough per-run USD by model. Override via setRunCost for your real numbers. */
const PER_RUN_USD: Record<string, number> = {
  "claude-opus-4-8": 0.5,
  "claude-sonnet-4-6": 0.15,
  "gpt-5-codex": 0.3,
};
const DEFAULT_RUN_USD = 0.4;

export function runCostForModel(model: string): number {
  return PER_RUN_USD[model] ?? DEFAULT_RUN_USD;
}

/** Estimate spend for one run: every dispatched task + every QA task it spawned. */
export function estimateRunSpend(state: RunState, org: Org, registry: StackRegistry): SpendBreakdown {
  const byRole: Record<string, number> = {};
  let totalUsd = 0;
  let runs = 0;

  const add = (role: RoleId, usd: number) => {
    byRole[role] = round2((byRole[role] ?? 0) + usd);
    totalUsd = round2(totalUsd + usd);
    runs += 1;
  };

  for (const task of state.plan.tasks) {
    if (!state.dispatched[task.id]) continue;
    add(task.role, runCostForModel(stackModel(org, registry, task.role)));
    // A QA task was spawned for this task → a QA worker run.
    if (state.qaIssues[task.id]) add("qa", runCostForModel(stackModel(org, registry, "qa")));
  }

  return { totalUsd, byRole, runs };
}

/** Sum several run estimates (for the briefing across a backlog). */
export function sumSpend(parts: SpendBreakdown[]): SpendBreakdown {
  const out: SpendBreakdown = { totalUsd: 0, byRole: {}, runs: 0 };
  for (const p of parts) {
    out.totalUsd = round2(out.totalUsd + p.totalUsd);
    out.runs += p.runs;
    for (const [role, usd] of Object.entries(p.byRole)) out.byRole[role] = round2((out.byRole[role] ?? 0) + usd);
  }
  return out;
}

/** One-line summary for a report/briefing. */
export function formatSpend(s: SpendBreakdown): string {
  if (s.runs === 0) return "Spend: ~$0 (nothing dispatched).";
  const parts = Object.entries(s.byRole)
    .sort((a, b) => b[1] - a[1])
    .map(([role, usd]) => `${role} $${usd.toFixed(2)}`);
  return `Spend: ~$${s.totalUsd.toFixed(2)} over ${s.runs} run(s) (${parts.join(", ")}). Estimate, not a bill.`;
}

function stackModel(org: Org, registry: StackRegistry, role: RoleId): string {
  try {
    const member = resolveMember(org, registry, role);
    return registry.get(member.stackId)?.model ?? "";
  } catch {
    return "";
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
