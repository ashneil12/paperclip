/**
 * Conversation memory + in-flight RunState persisted to Paperclip's ctx.state
 * (company scope). This is what makes the dispatch/poll cycle resumable across
 * requests and gives the CEO durable memory (V1) without a bespoke table.
 */
import type { PluginStateClient } from "../sdk";
import type { ConversationMemory, MemoryStore } from "../core/ports";
import type { RunState } from "../core/types";
import type { BriefingEntry } from "../brain/briefing";

export class PaperclipMemoryStore implements MemoryStore {
  constructor(private readonly state: PluginStateClient, private readonly companyId: string) {}

  async load(conversationId: string): Promise<ConversationMemory> {
    const raw = await this.state.get(this.key(`mem:${conversationId}`));
    if (raw && typeof raw === "object") return raw as ConversationMemory;
    return { conversationId, turns: [], summary: "" };
  }

  async save(memory: ConversationMemory): Promise<void> {
    await this.state.set({ ...this.key(`mem:${memory.conversationId}`), value: memory });
  }

  private key(stateKey: string) {
    return { scopeKind: "company", scopeId: this.companyId, stateKey: `command-center:${stateKey}` };
  }
}

/** Stash/restore the in-flight run so /chat/poll can advance it one tick at a time. */
export class RunStateStore {
  constructor(private readonly state: PluginStateClient, private readonly companyId: string) {}

  async load(conversationId: string): Promise<RunState | null> {
    const raw = await this.state.get(this.key(conversationId));
    return raw && typeof raw === "object" ? (raw as RunState) : null;
  }

  async save(run: RunState): Promise<void> {
    await this.state.set({ ...this.key(run.conversationId), value: run });
  }

  async clear(conversationId: string): Promise<void> {
    await this.state.set({ ...this.key(conversationId), value: null });
  }

  private key(conversationId: string) {
    return { scopeKind: "company", scopeId: this.companyId, stateKey: `command-center:run:${conversationId}` };
  }
}

/** The standing-objectives backlog (the autonomous loop's queue). Matches ObjectiveQueueStore. */
export class BacklogStore {
  constructor(private readonly state: PluginStateClient, private readonly companyId: string) {}
  async load(): Promise<string[]> {
    const raw = await this.state.get(this.key());
    return Array.isArray(raw) ? (raw as string[]) : [];
  }
  async save(queue: string[]): Promise<void> {
    await this.state.set({ ...this.key(), value: queue });
  }
  private key() {
    return { scopeKind: "company", scopeId: this.companyId, stateKey: "command-center:backlog" };
  }
}

/** Accumulated briefing entries (what the loop did) for the "while you were away" digest. */
export class BriefingStore {
  constructor(private readonly state: PluginStateClient, private readonly companyId: string) {}
  async load(): Promise<BriefingEntry[]> {
    const raw = await this.state.get(this.key());
    return Array.isArray(raw) ? (raw as BriefingEntry[]) : [];
  }
  async append(entry: BriefingEntry): Promise<void> {
    const all = await this.load();
    all.push(entry);
    await this.state.set({ ...this.key(), value: all });
  }
  async clear(): Promise<void> {
    await this.state.set({ ...this.key(), value: [] });
  }
  private key() {
    return { scopeKind: "company", scopeId: this.companyId, stateKey: "command-center:briefing" };
  }
}
