import { describe, it, expect } from "vitest";
import { heuristicIntent } from "../src/brain/intent";
import { CEO } from "../src/brain/ceo";
import { StackRegistry } from "../src/stacks/role-stacks";
import { OrgBuilder } from "../src/org/org";
import { InMemoryMemoryStore } from "../src/memory/memory-store";
import { FakeHands, makeFakeClock, makeFakeIdGen, instantMonitor } from "../harness/fakes";

describe("intent gate — talk vs work", () => {
  it("treats greetings + small talk as conversation (not a task)", () => {
    for (const t of ["hi", "HI", "hey", "hello", "yo", "ok", "thanks", "gm", "test", "sure", "nice", "lol"]) {
      expect(heuristicIntent(t)).toBe("conversation");
    }
  });

  it("treats questions about the CEO as conversation", () => {
    for (const t of ["what can you do?", "who are you", "how does this work?", "help", "status", "what's up"]) {
      expect(heuristicIntent(t)).toBe("conversation");
    }
  });

  it("treats real objectives as work", () => {
    for (const t of [
      "build a pricing page",
      "research competitor pricing",
      "fix the signup bug",
      "draft the launch email",
      "design the onboarding screen",
      "ship the webhook retry fix and QA it",
    ]) {
      expect(heuristicIntent(t)).toBe("objective");
    }
  });
});

describe("CEO conversational path does not dispatch", () => {
  function build() {
    const reg = new StackRegistry();
    const clock = makeFakeClock();
    const newId = makeFakeIdGen();
    const org = new OrgBuilder(reg, "co", "g").connect({ role: "ceo", agentId: "cc1" }).build();
    const hands = new FakeHands(newId, clock, { qa: "pass" });
    const ceo = new CEO({ org, registry: reg, hands, memory: new InMemoryMemoryStore(), clock, newId, monitor: instantMonitor });
    return { ceo, hands };
  }

  it("classifies 'hi' as conversation and replies without creating any issue", async () => {
    const { ceo, hands } = build();
    expect(await ceo.classify("hi")).toBe("conversation");
    const reply = await ceo.chat("hi");
    expect(reply.length).toBeGreaterThan(0);
    expect(hands.issues.size).toBe(0); // nothing dispatched
  });

  it("classifies a real objective as work", async () => {
    const { ceo } = build();
    expect(await ceo.classify("build a pricing page and QA it")).toBe("objective");
  });
});
