/**
 * Monitoring — how the CEO watches a dispatched task and reads its result back
 * from the governed control plane. V0 model: poll issue status + comments. (V1
 * swaps the poll for a live company-WS subscription; the parse stays the same.)
 */
import type { Hands, HandsComment } from "../core/ports";
import type { TaskRunResult } from "../core/types";

export interface MonitorOptions {
  /** Max poll attempts before giving up. */
  maxPolls: number;
  /** Sleep between polls. Injected so tests run with no real delay. */
  sleep: () => Promise<void>;
}

export const DEFAULT_MONITOR: MonitorOptions = {
  maxPolls: 60,
  sleep: () => new Promise((r) => setTimeout(r, 2000)),
};

// Truly terminal issue statuses. "blocked" is NOT terminal (it's waiting on deps).
const TERMINAL = new Set(["done", "cancelled"]);

/** Map a Paperclip issue status to a run outcome, or null if not yet terminal. */
export function readTerminal(status: string): "done" | "failed" | null {
  if (status === "done") return "done";
  if (status === "cancelled") return "failed"; // cancelled = the worker failed (no "failed" issue status)
  return null;
}

/** Poll until the task reaches a terminal status, then read its result. */
export async function awaitTaskResult(
  hands: Hands,
  taskId: string,
  issueId: string,
  opts: MonitorOptions = DEFAULT_MONITOR,
): Promise<TaskRunResult> {
  for (let i = 0; i < opts.maxPolls; i++) {
    const issue = await hands.getTask(issueId);
    if (issue && TERMINAL.has(issue.status)) {
      const comments = await hands.listComments(issueId);
      return readResult(taskId, issueId, issue.status, comments);
    }
    await opts.sleep();
  }
  return { taskId, issueId, status: "blocked", resultSummary: "Timed out waiting for worker result." };
}

function readResult(taskId: string, issueId: string, status: string, comments: HandsComment[]): TaskRunResult {
  const lastAgent = [...comments].reverse().find((c) => c.authorKind === "agent" || c.authorAgentId);
  const summary = lastAgent?.body?.trim() || "(no result comment posted)";
  // Only "done" and "cancelled" reach here (TERMINAL); cancelled = the worker failed.
  const mapped: TaskRunResult["status"] = status === "done" ? "done" : "failed";
  return { taskId, issueId, status: mapped, resultSummary: summary };
}
