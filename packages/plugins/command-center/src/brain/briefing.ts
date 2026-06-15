/**
 * The morning briefing — "while you were away."
 *
 * You go to bed; the CEO keeps working through the backlog (see operator-loop.ts).
 * When you wake up, this is the one thing to read: what shipped, what needs your
 * call, what's stuck, and what it cost. Deterministic + testable; the host can pass
 * an LLM to polish the prose, but the structure is fixed.
 */
import type { CeoReply } from "../core/types";
import { sumSpend, formatSpend, type SpendBreakdown } from "./cost";

export interface BriefingEntry {
  objective: string;
  reply: CeoReply;
  spend?: SpendBreakdown;
}

type Status = "shipped" | "needs you" | "needs rework";

function statusOf(reply: CeoReply): Status {
  if (reply.awaitingHuman || reply.actions.some((a) => a.kind === "ask")) return "needs you";
  if (reply.actions.some((a) => a.kind === "qa" && !a.verdict.passed)) return "needs rework";
  return "shipped";
}

const ICON: Record<Status, string> = { shipped: "✅", "needs you": "❓", "needs rework": "❌" };

export function synthesizeBriefing(entries: BriefingEntry[], when = "overnight"): string {
  if (entries.length === 0) return `Good morning. Nothing was queued ${when} — the team is idle and waiting for your next objective.`;

  const lines: string[] = [];
  lines.push(`# Good morning — while you were away (${when})`);
  lines.push(`Worked ${entries.length} objective(s).`);

  const byStatus: Record<Status, BriefingEntry[]> = { shipped: [], "needs you": [], "needs rework": [] };
  for (const e of entries) byStatus[statusOf(e.reply)].push(e);

  if (byStatus.shipped.length) {
    lines.push("\n**Shipped**");
    for (const e of byStatus.shipped) lines.push(`${ICON.shipped} ${e.objective}`);
  }
  if (byStatus["needs you"].length) {
    lines.push("\n**Needs your call** (held at a governance gate — I did not proceed)");
    for (const e of byStatus["needs you"]) {
      const ask = e.reply.actions.find((a) => a.kind === "ask");
      lines.push(`${ICON["needs you"]} ${e.objective}${ask && ask.kind === "ask" ? ` — ${ask.reason}` : ""}`);
    }
  }
  if (byStatus["needs rework"].length) {
    lines.push("\n**Needs rework** (QA failed — I did not ship it)");
    for (const e of byStatus["needs rework"]) lines.push(`${ICON["needs rework"]} ${e.objective}`);
  }

  const spend = sumSpend(entries.map((e) => e.spend).filter((s): s is SpendBreakdown => Boolean(s)));
  lines.push(`\n${formatSpend(spend)}`);

  lines.push("\n**Start here**");
  for (const m of firstMoves(byStatus)) lines.push(`- ${m}`);

  return lines.join("\n");
}

function firstMoves(byStatus: Record<Status, BriefingEntry[]>): string[] {
  const moves: string[] = [];
  if (byStatus["needs you"].length) moves.push(`Answer the ${byStatus["needs you"].length} gate question(s) — those are the only things blocked on you.`);
  if (byStatus["needs rework"].length) moves.push(`Review the ${byStatus["needs rework"].length} QA failure(s); say "rework" and I'll re-dispatch with the findings baked in.`);
  if (byStatus.shipped.length && moves.length < 2) moves.push(`${byStatus.shipped.length} item(s) shipped and verified — skim and tell me the next objective.`);
  while (moves.length < 2) moves.push("Queue the next objective; the team is free.");
  return moves.slice(0, 2);
}
