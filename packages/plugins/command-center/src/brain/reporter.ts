/**
 * The reporter — how the CEO closes the loop with the operator. Deterministic
 * (testable) structured synthesis; the host may pass an LLM to polish the prose,
 * but the structure (what shipped / what's blocked / what needs you / next moves)
 * is fixed.
 */
import type { Plan, QAVerdict, Task, TaskRunResult } from "../core/types";

export interface ReportInput {
  plan: Plan;
  results: Map<string, TaskRunResult>;
  verdicts: Map<string, QAVerdict>;
  asks: Array<{ task: Task; reason: string }>;
}

export function synthesizeReport(input: ReportInput): string {
  const { plan, results, verdicts, asks } = input;
  const byId = new Map(plan.tasks.map((t) => [t.id, t]));

  const shipped: string[] = [];
  const failed: string[] = [];
  const blocked: string[] = [];

  for (const task of plan.tasks) {
    const result = results.get(task.id);
    const verdict = verdicts.get(task.id);
    if (!result) continue;
    if (result.status === "done") {
      if (task.needsQA) {
        if (verdict?.passed) {
          const adv = verdict.advisory?.length ? ` (advisory: ${verdict.advisory.join("; ")})` : "";
          shipped.push(`✅ ${task.title} — verified by QA${adv}`);
        } else if (verdict) failed.push(`❌ ${task.title} — QA FAILED: ${verdict.findings.join("; ") || "criteria unproven"}`);
        else shipped.push(`✅ ${task.title} (no QA run)`);
      } else {
        shipped.push(`✅ ${task.title}`);
      }
    } else if (result.status === "failed") {
      failed.push(`❌ ${task.title} — ${oneLine(result.resultSummary)}`);
    } else {
      blocked.push(`⏸️ ${task.title} — ${oneLine(result.resultSummary)}`);
    }
  }

  const lines: string[] = [];
  lines.push(plan.summary);
  lines.push("");

  if (shipped.length) lines.push("**Shipped**\n" + shipped.join("\n"));
  if (failed.length) lines.push("\n**Needs rework**\n" + failed.join("\n"));
  if (blocked.length) lines.push("\n**Blocked**\n" + blocked.join("\n"));

  if (asks.length) {
    lines.push(
      "\n**Needs you** (governance gate — I won't proceed without your call)\n" +
        asks.map((a) => `❓ ${a.task.title} — ${a.reason}`).join("\n"),
    );
  }

  lines.push("\n**Next moves**\n" + nextMoves(shipped.length, failed.length, asks.length, byId).join("\n"));

  // Visible signal when the CEO planned with rules instead of the model (auth/model issue).
  if (/heuristic/i.test(plan.rationale)) {
    lines.push(
      "\n_⚠ Planned without the model — the CEO's `claude` brain isn't authenticated in this server, " +
        "so it fell back to rule-based planning. Run the server where `claude` is logged in (or set ANTHROPIC_API_KEY) to make it actually reason._",
    );
  }
  return lines.join("\n");
}

function nextMoves(shippedCount: number, failedCount: number, askCount: number, _byId: Map<string, Task>): string[] {
  const moves: string[] = [];
  if (askCount) moves.push(`1. Answer the ${askCount} gate question(s) above and I'll finish those.`);
  if (failedCount) moves.push(`${moves.length + 1}. Greenlight a re-work pass on the failed item(s) — I'll re-dispatch with the QA findings baked in.`);
  if (shippedCount && moves.length < 2) moves.push(`${moves.length + 1}. Tell me the next objective; the team is free.`);
  while (moves.length < 2) moves.push(`${moves.length + 1}. Point me at the next objective.`);
  return moves.slice(0, 2);
}

function oneLine(text: string): string {
  const flat = (text || "").replace(/\s+/g, " ").trim();
  return flat.length <= 140 ? flat : `${flat.slice(0, 137)}…`;
}
