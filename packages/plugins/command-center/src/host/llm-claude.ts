/**
 * LLM port backed by the local `claude` CLI — the same mechanism board-chat.ts
 * uses. The CEO's stack persona (OperatorOS) is passed as the system prompt, so
 * the brain plans and talks in the OperatorOS voice. Buffered JSON mode
 * (`--output-format json`) is the right fit for the V0 plan/dispatch route.
 *
 * Requires the `claude` binary on PATH and a local-trusted deployment (it passes
 * --dangerously-skip-permissions, exactly like board-chat). For hosted mode the
 * brain should instead run as a first-class Paperclip agent through the heartbeat.
 */
import { spawn } from "node:child_process";
import type { LLM, LlmJsonRequest, LlmRequest } from "../core/ports";

export interface ClaudeLlmOptions {
  bin?: string;
  model?: string;
  cwd?: string;
  extraArgs?: string[];
  timeoutMs?: number;
}

export class ClaudeCliLLM implements LLM {
  constructor(private readonly opts: ClaudeLlmOptions = {}) {}

  async complete(input: LlmRequest): Promise<string> {
    const system = [input.system, ...input.messages.filter((m) => m.role === "system").map((m) => m.content)]
      .filter(Boolean)
      .join("\n\n");
    const prompt = input.messages
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const args = ["-p", "--output-format", "json", "--dangerously-skip-permissions"];
    const model = input.model ?? this.opts.model;
    if (model) args.push("--model", model);
    if (system) args.push("--append-system-prompt", system);
    if (this.opts.extraArgs) args.push(...this.opts.extraArgs);

    const raw = await run(this.opts.bin ?? "claude", args, prompt, this.opts.cwd, this.opts.timeoutMs ?? 180_000);
    try {
      const parsed = JSON.parse(raw) as { result?: unknown };
      return typeof parsed.result === "string" ? parsed.result : raw;
    } catch {
      return raw;
    }
  }

  async completeJSON<T>(input: LlmJsonRequest<T>): Promise<T> {
    const system = `${input.system ?? ""}\n\nReturn ONLY valid JSON matching the requested schema. No prose, no markdown, no code fences.`.trim();
    const text = await this.complete({ ...input, system });
    return input.parse(JSON.parse(extractJson(text)));
  }
}

function run(bin: string, args: string[], stdin: string, cwd: string | undefined, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`claude CLI exited ${code}: ${err || out}`));
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** Pull the first JSON object/array out of a model response, tolerating fences/prose. */
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1]?.trim() ?? text.trim();
  const start = body.search(/[[{]/);
  if (start === -1) return body;
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++;
    else if (body[i] === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start);
}
