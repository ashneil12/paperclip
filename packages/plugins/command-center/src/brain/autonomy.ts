/**
 * The autonomy gate — the thing that makes the CEO act-then-report instead of
 * asking permission for everything. Encodes the OperatorOS guardrail: decide and
 * move on anything reversible; pause ONLY for a real governance gate (payments,
 * irreversible/destructive actions, spend ceilings, or a strategic fork only the
 * human can call).
 */
import type { AutonomyPosture, Decision, Task } from "../core/types";

export interface AutonomyConfig {
  /** Spend at or above this (USD) trips the human gate. */
  spendCeilingUsd: number;
}

export const DEFAULT_AUTONOMY: AutonomyConfig = { spendCeilingUsd: 50 };

const IRREVERSIBLE = /\b(delete|drop|destroy|rotate|revoke|wipe|truncate|force[- ]?push|prod(uction)?\b|charge|refund|pay(ment)?|transfer|send (money|funds)|cancel subscription|terminate)\b/i;

/** Classify a task into a decision the gate can reason about. */
export function classifyTaskDecision(task: Task, estimatedSpendUsd = 0): Decision {
  const text = `${task.title} ${task.description} ${task.acceptanceCriteria}`;
  const irreversible = IRREVERSIBLE.test(text);
  return {
    description: task.title,
    reversible: !irreversible,
    governanceGated: irreversible,
    estimatedSpendUsd,
  };
}

/**
 * Returns a reason string if the human must be asked, or null to proceed.
 * This is the whole "stop asking me questions" policy in one function.
 */
export function requiresHuman(decision: Decision, posture: AutonomyPosture, cfg: AutonomyConfig = DEFAULT_AUTONOMY): string | null {
  if (posture === "read-only") return "Role is read-only; cannot dispatch work.";

  const overSpend = (decision.estimatedSpendUsd ?? 0) >= cfg.spendCeilingUsd;
  if (overSpend) return `Estimated spend $${decision.estimatedSpendUsd} ≥ ceiling $${cfg.spendCeilingUsd}.`;
  if (decision.governanceGated || !decision.reversible) {
    return `Irreversible or governance-gated action: ${decision.description}.`;
  }
  if (posture === "ask-first") return `Posture is ask-first: confirm "${decision.description}".`;

  return null; // act-then-report: proceed
}
