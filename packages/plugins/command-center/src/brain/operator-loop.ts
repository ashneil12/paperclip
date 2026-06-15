/**
 * The operator loop — the CEO keeps working a backlog between conversations.
 *
 * You queue objectives (or the CEO/roadmap does), go to bed, and the loop drains
 * them one at a time through the normal governed pipeline, accumulating a briefing
 * you read in the morning. This is your AEON autonomous-business pattern, but
 * inside the CEO and behind the same audit + budget + QA guarantees.
 *
 * Host wiring: persist the queue via ctx.state (ObjectiveQueueStore), and drive
 * `tick()` from a Paperclip routine/job on a schedule. Standalone: `drain()`.
 */
import type { CEO } from "./ceo";
import { synthesizeBriefing, type BriefingEntry } from "./briefing";

export interface ObjectiveQueueStore {
  load(): Promise<string[]>;
  save(queue: string[]): Promise<void>;
}

export class InMemoryQueueStore implements ObjectiveQueueStore {
  private q: string[] = [];
  async load(): Promise<string[]> {
    return [...this.q];
  }
  async save(queue: string[]): Promise<void> {
    this.q = [...queue];
  }
}

export class OperatorLoop {
  private processed: BriefingEntry[] = [];

  constructor(
    private readonly ceo: CEO,
    private readonly store: ObjectiveQueueStore = new InMemoryQueueStore(),
    private readonly convBase = "loop",
  ) {}

  async enqueue(...objectives: string[]): Promise<void> {
    const q = await this.store.load();
    await this.store.save([...q, ...objectives]);
  }

  async pending(): Promise<number> {
    return (await this.store.load()).length;
  }

  /** Process ONE objective off the queue. Returns its briefing entry, or null if empty. */
  async tick(): Promise<BriefingEntry | null> {
    const q = await this.store.load();
    const next = q[0];
    if (next === undefined) return null;
    await this.store.save(q.slice(1));
    const convId = `${this.convBase}_${this.processed.length + 1}`;
    const reply = await this.ceo.handleObjective(next, convId, "operator-loop");
    const entry: BriefingEntry = { objective: next, reply, spend: reply.spend };
    this.processed.push(entry);
    return entry;
  }

  /** Drain the whole backlog (bounded by a safety cap). */
  async drain(maxIterations = 100): Promise<BriefingEntry[]> {
    const out: BriefingEntry[] = [];
    for (let i = 0; i < maxIterations; i++) {
      const entry = await this.tick();
      if (!entry) break;
      out.push(entry);
    }
    return out;
  }

  processedEntries(): BriefingEntry[] {
    return [...this.processed];
  }

  briefing(when = "overnight"): string {
    return synthesizeBriefing(this.processed, when);
  }
}
