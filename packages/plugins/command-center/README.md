# Command Center — a chatable CEO over Paperclip

A conversational **CEO agent** you talk to like a partner. It decomposes your
objectives, dispatches each piece to the right member of your agent fleet through
Paperclip's governed control plane (budgets, checkout, approvals, audit),
**verifies the work before declaring done**, and reports back. Built additively as
a Paperclip plugin — the fork stays a thin deploy wrapper.

The thing you asked for: **connect a Claude Code as the CEO and the OperatorOS
stack drops in automatically**; give every other member its own stack (engineer →
Codex, QA → Playwright + `@clerk/testing` gate with a Midscene advisory lane, etc.).

## Status: V0–V3 built, typechecked, tested, and runnable

```bash
pnpm install
pnpm typecheck   # tsc --noEmit — clean
pnpm test        # vitest — 26 passing across 8 files
pnpm demo        # runs the whole CEO loop end-to-end against an in-memory host
```

`pnpm demo` shows: V3 role-stack injection, V0 decompose→dispatch→report through
the seam, V1 live events + cross-turn memory, V2 the QA gate (pass **and** fail),
and the autonomy gate holding a destructive objective for you.

## Architecture — Brain on Hands

```
 you ──chat──▶ CEO (OperatorOS persona, run on the claude CLI)
                │  plan → route → THE SEAM:  hands.createTask(...) then hands.wakeTask(...)
                ▼
        Paperclip hands (ctx.issues): budgets · checkout · approvals · audit
                │  heartbeat runs the assignee with its injected stack
                ▼
        workers: claude · codex · cursor · http     →  results land as issue comments
                │
                ▼
        CEO collects results, runs the QA verify gate, reports back in chat
```

The CEO logic is **pure** (depends only on small ports), so the exact same code
runs against the in-memory harness (tests/demo) and the real Paperclip host.

| Layer | Files |
|---|---|
| Domain | `src/core/types.ts`, `src/core/ports.ts` |
| V3 role stacks | `src/stacks/operatoros-stack.ts` (real OperatorOS persona), `role-stacks.ts`, `stack-injector.ts` |
| Org | `src/org/org.ts` |
| Brain | `src/brain/{planner,router,autonomy,monitor,reporter,run,ceo}.ts` |
| V2 QA gate | `src/qa/verify-gate.ts` |
| V1 memory | `src/memory/memory-store.ts` |
| Host bindings | `src/host/{manifest,worker,hands-paperclip,state-store,llm-claude}.ts` |
| UI | `src/ui/{agent-adapters,CeoChat,index}.tsx` (`agent-adapters.ts` ported verbatim from hivra) |
| Harness/tests | `harness/`, `test/` |

## V0 → V3

- **V0** — decompose → dispatch (create + explicit wake) → monitor → report. Buffered `/chat` + `/poll` (plugin API routes are JSON-only; no streaming).
- **V1** — durable memory + compaction (`ctx.state`), live event feed, resumable dispatch/poll cycle (`RunState`), non-blocking ticks.
- **V2** — the QA verify gate: auto-spawn a QA task, only accept on `VERDICT: PASS`, route FAIL to rework. Two-lane — a REQUIRED deterministic check (Playwright + `@clerk/testing` + `toHaveScreenshot`) is authoritative; a Midscene `ADVISORY:` lane is reported but never blocks. Equipped via the `qa-verify-gate` skill.
- **V3** — **role stacks**: each role is a bundle (persona + skills + tools + adapter + model + memory + autonomy). Connecting an agent to a role injects its stack as Paperclip `assigneeAdapterOverrides` on every dispatched task. CEO seat → OperatorOS. Same role can run different stacks (engineer-claude vs engineer-codex).

## Connect agents to roles (the roster)

Plugin instance config:

```json
{
  "defaultGoalId": "goal_root",
  "roster": [
    { "role": "ceo",        "agentId": "agent_my_claude_code" },
    { "role": "engineer",   "agentId": "agent_codex", "stackId": "engineer-codex" },
    { "role": "qa",         "agentId": "agent_qa" },
    { "role": "researcher", "agentId": "agent_research" },
    { "role": "marketer",   "agentId": "agent_marketer" }
  ]
}
```

The CEO seat auto-injects OperatorOS. Define your own stacks with `config.stacks`
(a list of `RoleStack` objects) and point a role at one via `stackId`.

## Dropping it into your Paperclip fork

This is an **out-of-tree plugin** — the command center isn't in the fork; the fork
just registers it. To wire it in:

1. Copy this package to `paperclip/packages/plugins/command-center` (or keep it
   external and register its path).
2. Delete `src/sdk/` and depend on `@paperclipai/plugin-sdk` (`workspace:*`); the
   named exports line up 1:1 (the shim mirrors the real SDK).
3. Add an esbuild/rollup build (copy the `plugin-orchestration-smoke-example`
   config) producing `dist/host/manifest.js`, `dist/host/worker.js`, `dist/ui/`.
4. Register the plugin path and set the instance config roster + `defaultGoalId`.
5. Run local-trusted with `claude` on PATH (the CEO brain spawns the CLI, like
   `board-chat.ts`).

## Honest caveats (and where each is handled)

- **No streaming from the plugin backend.** Plugin API routes are JSON-only
  (`PLUGIN_SPEC.md:31`). V0 is buffered + poll. V1 live streaming = subscribe the
  company WS bus and render raw agent events through `src/ui/agent-adapters.ts`.
- **CEO brain via `claude` CLI = local-trusted only.** For hosted/multi-user,
  promote the CEO to a first-class heartbeat agent (its run is then governed +
  budgeted like any worker). The brain is behind the `LLM` port, so it's one swap.
- **In-process event bus = single node.** Multi-tenant fleet needs an external bus
  (upstream disclaims cloud-readiness).
- **`ctx.assets` not built** — no plugin file-upload path yet; the chat composer
  is text-only in V0.
- The seam always goes through `hands` (→ `ctx.issues`), never raw DB writes, so
  budget/checkout/approval/audit invariants hold. `create()` is always followed by
  an explicit `requestWakeup()` (create does not auto-wake — verified upstream).

## Fork-sync discipline

Everything additive lives in this package. Treat upstream core as read-only; merge
(don't rebase) `upstream/main`; pin `apiVersion`/`minimumHostVersion`; CI against
stable **and** canary. The one place that may need a thin in-core Platform Module
is live streaming (V1) — allowlist it, don't sprawl.
