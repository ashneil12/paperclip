# AGENTS.md — start here

You are an AI working on **Command Center**: a chatable CEO agent over the
open-source [Paperclip](https://github.com/paperclipai/paperclip) orchestration
platform. The owner (Ash) talks to a CEO like a partner; the CEO decomposes the
objective, dispatches each piece to the right member of an agent fleet **through
Paperclip's governed control plane** (budgets, checkout, approvals, audit),
**verifies the work before declaring done**, and reports back. Per-role "stacks"
auto-inject when an agent is connected to a role (CEO seat → OperatorOS persona).

This is built as an **additive Paperclip plugin** (the fork stays a thin wrapper).

## Status (2026-06-16): V0–V3 built, tested, buildable. Live-on-fleet = next phase.

Verify in ~30s — all four must stay green before and after any change:

```bash
pnpm install
pnpm typecheck   # tsc --noEmit → clean
pnpm test        # vitest → 26 passing / 8 files
pnpm demo        # prints the full CEO loop end-to-end (in-memory host)
pnpm build       # esbuild → dist/host/{worker,manifest}.js + dist/ui/index.js
```

If any of those is red, fix it before doing anything else.

## How this is organized (the file map)

| Area | Path | What |
|---|---|---|
| Domain model | `src/core/types.ts`, `src/core/ports.ts` | Pure types + the ports the brain depends on. No Paperclip imports. |
| V3 role stacks | `src/stacks/` | `operatoros-stack.ts` (real OperatorOS persona), `role-stacks.ts` (registry + built-ins), `stack-injector.ts` (connect→inject) |
| Org | `src/org/org.ts` | The roster: role → bound agent + stack |
| Brain | `src/brain/` | `planner` (decompose), `router` (route+dispatch), `autonomy` (act-then-report gate), `monitor`, `reporter`, `run` (the resumable reducer), `ceo` (orchestrator) |
| V2 QA gate | `src/qa/verify-gate.ts` | spawn QA, collect verdict, refuse "done" on FAIL. Two-lane: deterministic gate (Playwright + `@clerk/testing` + `toHaveScreenshot`) is authoritative; Midscene `ADVISORY:` lane never blocks. QA member equipped via `skills/qa-verify-gate/SKILL.md`. |
| V1 memory | `src/memory/memory-store.ts` | transcript + compaction |
| Host bindings | `src/host/` | `manifest`, `worker` (/chat,/poll,/roster routes), `hands-paperclip` (→ ctx.issues), `state-store` (→ ctx.state), `llm-claude` (the claude CLI) |
| UI | `src/ui/` | `agent-adapters.ts` (ported verbatim from hivra), `CeoChat.tsx`, `index.tsx` |
| Harness/tests | `harness/`, `test/` | in-memory fakes + the runnable demo + 26 specs |
| SDK shim | `src/sdk/index.ts` | faithful mirror of `@paperclipai/plugin-sdk` (swap for the real dep in-tree) |
| Design + critique | `docs/PLAN.md` | the grounded plan and its adversarial review |
| Overview | `README.md` | human-facing summary + drop-in instructions |

## The golden rules (do not break these)

1. **The core is pure.** `src/core`, `src/brain`, `src/stacks`, `src/qa`,
   `src/memory`, `src/org` depend ONLY on the ports in `src/core/ports.ts`. No
   Paperclip imports, no `Date.now()`/`Math.random()` (use the injected `Clock`
   and `IdGen`). This is what keeps it testable and host-agnostic.
2. **Every CEO action goes through `Hands`** (→ `ctx.issues`). Never raw DB writes
   — that's what preserves budget / checkout / approval / audit.
3. **`create` then explicit `wakeTask`.** Creating a task does NOT auto-wake the
   assignee (verified upstream). Always wake explicitly.
4. **Keep all 26 tests green.** Add tests for new behavior. The tests are the spec.
5. **Additive only.** When integrating in-tree, never edit Paperclip core; this
   ships as a plugin. The one allowed in-core seam (live streaming) is a documented
   future Platform Module.

## Verified facts about Paperclip (don't re-research these)

Checked against the real upstream clone at **`~/Projects/paperclip`** (origin
`paperclipai/paperclip`, branch `master`):

- Plugin API routes are **JSON-only — no streaming** (`PLUGIN_SPEC.md:31`,
  `onApiRequest` returns one buffered `PluginApiResponse`). V0 is buffered + poll;
  V1 streaming = subscribe the company WS bus and render via `src/ui/agent-adapters.ts`.
- `ctx.assets` (plugin uploads) is **not built yet** — chat is text-only in V0.
- The live-events bus is **in-process (single node)** — multi-tenant fleet needs an
  external bus (upstream disclaims cloud-readiness).
- The "zero-core externalized adapter" precedent lives on **HenkDz's fork branch**,
  not upstream main — so a streaming/adapter seam is a small in-core Platform Module.
- Real plugin example to copy build config from:
  `~/Projects/paperclip/packages/plugins/examples/plugin-orchestration-smoke-example`.

## How to extend it

- **Add a team role / member:** add a `RoleStack` to `src/stacks/role-stacks.ts`
  (persona + skills + tools + adapter + model + memory + autonomy), then connect an
  agent to that role (config roster `stackId`, or `OrgBuilder.connect`). The stack
  auto-injects as `assigneeAdapterOverrides` on dispatch. The CEO routes to it once
  the role has a member.
- **Change how the CEO plans:** `src/brain/planner.ts` (LLM-first with a
  deterministic heuristic fallback). Keep the heuristic working — tests pin it.
- **Tune autonomy:** `src/brain/autonomy.ts` (what's reversible vs governance-gated).

## Live integration — the remaining phase (human-gated)

The package is drop-in ready. To run it inside Paperclip:

1. **[needs Ash]** fork `paperclipai/paperclip` to his GitHub (the one outward step).
2. Copy this package to `paperclip/packages/plugins/command-center`.
3. Delete `src/sdk/` and depend on `@paperclipai/plugin-sdk` (`workspace:*`) — the
   exports line up 1:1. Switch the build to the SDK bundler preset (see the example).
4. Register the plugin path + set the instance config roster + `defaultGoalId`.
5. Run Paperclip local-trusted with `claude` on PATH (the CEO brain spawns the CLI,
   like `board-chat.ts`). For hosted/multi-user, promote the CEO to a first-class
   heartbeat agent (it's behind the `LLM` port — one swap).

See `docs/PLAN.md` for the full design + the adversarial critique behind these choices.
