/**
 * Intent gate — the difference between a CEO you can TALK to and a dumb dispatcher.
 *
 * Not every message is work. "hi", "what can you do?", "thanks", "how's it going"
 * are conversation — the CEO should reply, not spin up a task. Only an actual
 * objective ("build X", "research Y", "ship Z") gets decomposed + dispatched.
 *
 * LLM-first (the CEO actually reads intent), with a deterministic heuristic fallback
 * so it still behaves with no model wired (and so tests are hermetic).
 */
import type { LLM } from "../core/ports";

export type Intent = "objective" | "conversation";

const WORK_VERB =
  /\b(build|create|add|fix|ship|implement|implement|write|design|research|investigate|draft|set ?up|make|generate|deploy|refactor|migrate|launch|plan|analyz|analys|review|update|remove|delete|wire|integrate|spin up|scaffold|audit|optimi|automate|configure|rename|move)\b/i;
const GREETING =
  /^(hi|hey+|hello|yo|sup|gm|ga|gn|good (morning|afternoon|evening)|thanks|thank you|ty|cheers|ok(ay)?|cool|nice|great|lol|lmao|test|ping|hmm+|yep|yes|no|nope|sure)\b[!.… ]*$/i;
const QUESTION_LEAD =
  /^(who|what|what's|whats|why|how|how's|hows|when|where|which|can you|could you|do you|are you|is there|should i|tell me|explain|status|help)\b/i;

/** Deterministic classifier. The contract the tests pin. */
export function heuristicIntent(text: string): Intent {
  const t = text.trim();
  if (!t) return "conversation";
  if (t.length <= 3) return "conversation"; // "hi", "ok", "yo"
  if (GREETING.test(t)) return "conversation"; // pure greeting/ack
  if (WORK_VERB.test(t)) return "objective"; // an explicit work verb anywhere = work
  // A question with no work verb is conversation ("what can you do?", "how does this work?").
  if (QUESTION_LEAD.test(t) || t.endsWith("?")) return "conversation";
  // Very short non-imperative messages → conversation; longer statements → assume an objective.
  if (t.split(/\s+/).length <= 4) return "conversation";
  return "objective";
}

export async function classifyIntent(text: string, llm?: LLM): Promise<Intent> {
  if (llm) {
    try {
      const out = await llm.complete({
        system:
          "Classify the user's message in one word. Reply OBJECTIVE if they are asking you to get work done, build, change, research, or ship something. Reply CONVERSATION if it is a greeting, a question about you/your status/capabilities, thanks, or small talk. One word only.",
        messages: [{ role: "user", content: text }],
      });
      const v = out.trim().toLowerCase();
      if (v.startsWith("objective")) return "objective";
      if (v.startsWith("conversation")) return "conversation";
    } catch {
      /* fall through to heuristic */
    }
  }
  return heuristicIntent(text);
}

/** A conversational reply (no dispatch). LLM in the CEO's voice, or a useful canned reply. */
export async function conversationalReply(text: string, opts: { llm?: LLM; persona?: string; contextSummary?: string }): Promise<string> {
  if (opts.llm) {
    try {
      const system = [opts.persona, opts.contextSummary ? `Recent context:\n${opts.contextSummary}` : ""].filter(Boolean).join("\n\n");
      const reply = await opts.llm.complete({ system: system || undefined, messages: [{ role: "user", content: text }] });
      if (reply.trim()) return reply.trim();
    } catch {
      /* fall through */
    }
  }
  return defaultConversationalReply(text);
}

function defaultConversationalReply(text: string): string {
  const t = text.trim().toLowerCase();
  if (/^(thanks|thank you|ty|cheers)/.test(t)) return "Anytime. Point me at the next objective and I'll run it.";
  if (/(what can you|who are you|help|how (do|does)|capab)/.test(t)) {
    return [
      "I'm your CEO. You talk to me; I run the team.",
      "Give me an objective and I decompose it, route each piece to the right member (engineer, QA, researcher, marketer, designer), dispatch it through the governed control plane, verify it, and report back.",
      "Try: \"Build a pricing page and QA it before shipping\" or \"Research our top 3 competitors' pricing.\"",
    ].join(" ");
  }
  return "Hey. I'm your CEO — tell me an objective and I'll break it down, assign it, verify it, and report back. What do you want to get done?";
}
