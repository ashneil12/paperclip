import { describe, it, expect } from "vitest";
import { appendTurn, compactIfNeeded, renderContext } from "../src/memory/memory-store";
import type { ConversationMemory } from "../src/core/ports";

const empty = (): ConversationMemory => ({ conversationId: "c", turns: [], summary: "" });

describe("V1 — conversation memory", () => {
  it("folds old turns into the summary and retains the most recent", () => {
    let mem = empty();
    for (let i = 0; i < 10; i++) mem = appendTurn(mem, "user", `msg ${i}`, "t");
    const out = compactIfNeeded(mem, { retainTurns: 3, summarizeAfterTurns: 5 });
    expect(out.turns).toHaveLength(3);
    expect(out.turns[2]!.text).toBe("msg 9");
    expect(out.summary).toContain("msg 0");
    expect(renderContext(out)).toContain("Earlier");
  });

  it("is a no-op under the threshold", () => {
    let mem = empty();
    mem = appendTurn(mem, "user", "hi", "t");
    const out = compactIfNeeded(mem, { retainTurns: 3, summarizeAfterTurns: 5 });
    expect(out.turns).toHaveLength(1);
    expect(out.summary).toBe("");
  });
});
