/**
 * V1 — durable conversation memory + compaction.
 *
 * The CEO keeps a rolling transcript per conversation. When it grows past the
 * stack's threshold, the oldest turns are folded into a text summary and dropped,
 * so long-running threads never blow the context window (the known replay cliff).
 *
 * InMemoryMemoryStore is used by tests + the harness; the host implements the
 * MemoryStore port over `ctx.state` (agent_runtime_state) for real persistence.
 */
import type { ConversationMemory, MemoryStore } from "../core/ports";
import type { ConversationRole, ConversationTurn } from "../core/types";

export class InMemoryMemoryStore implements MemoryStore {
  private data = new Map<string, ConversationMemory>();

  async load(conversationId: string): Promise<ConversationMemory> {
    const existing = this.data.get(conversationId);
    if (existing) return clone(existing);
    return { conversationId, turns: [], summary: "" };
  }

  async save(memory: ConversationMemory): Promise<void> {
    this.data.set(memory.conversationId, clone(memory));
  }
}

export function appendTurn(mem: ConversationMemory, role: ConversationRole, text: string, ts: string): ConversationMemory {
  const turn: ConversationTurn = { role, text, ts };
  return { ...mem, turns: [...mem.turns, turn] };
}

export interface MemoryPolicy {
  retainTurns: number;
  summarizeAfterTurns: number;
}

/**
 * Compact if the transcript exceeds the threshold: fold the oldest turns into the
 * rolling summary, keep the most recent `retainTurns`. Deterministic (no LLM
 * needed) so it is testable; the host may pass an LLM to produce a nicer summary.
 */
export function compactIfNeeded(
  mem: ConversationMemory,
  policy: MemoryPolicy,
  summarize: (turns: ConversationTurn[]) => string = defaultSummarize,
): ConversationMemory {
  if (mem.turns.length <= policy.summarizeAfterTurns) return mem;
  const dropCount = mem.turns.length - policy.retainTurns;
  if (dropCount <= 0) return mem;
  const toFold = mem.turns.slice(0, dropCount);
  const kept = mem.turns.slice(dropCount);
  const foldedSummary = summarize(toFold);
  const summary = [mem.summary, foldedSummary].filter(Boolean).join("\n");
  return { ...mem, summary, turns: kept };
}

function defaultSummarize(turns: ConversationTurn[]): string {
  return turns.map((t) => `- ${t.role}: ${oneLine(t.text)}`).join("\n");
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= 160 ? flat : `${flat.slice(0, 157)}…`;
}

/** The transcript the CEO sends to the model: summary + retained turns. */
export function renderContext(mem: ConversationMemory): string {
  const parts: string[] = [];
  if (mem.summary) parts.push(`# Earlier (summary)\n${mem.summary}`);
  if (mem.turns.length) {
    parts.push("# Recent\n" + mem.turns.map((t) => `${t.role}: ${t.text}`).join("\n"));
  }
  return parts.join("\n\n");
}

function clone(m: ConversationMemory): ConversationMemory {
  return { conversationId: m.conversationId, summary: m.summary, turns: m.turns.map((t) => ({ ...t })) };
}
