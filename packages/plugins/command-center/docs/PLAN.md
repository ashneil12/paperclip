# Chatable CEO Command Center over Paperclip — Corrected Build Plan
**For:** Ash (solo founder, BYO-model, Next.js/React). **Date:** 2026-06-16
**Status:** Strategy sound; V0 wire corrected after adversarial review + direct code verification against the cloned upstream repo (`paperclipai/paperclip`, HEAD #2619).

---

## 0. What the review changed (all verified against the real code)
The first draft was directionally right but wrong on three load-bearing details. Verified facts:

1. **Plugin API routes are JSON-only, buffered, single-response.** `PLUGIN_SPEC.md:31` ("Scoped plugin API routes are JSON-only") + `onApiRequest(): Promise<PluginApiResponse>` (`define-plugin.ts:245`, a single `{status,headers,body}`). **There is no `stream` slot.** → Token-by-token streaming from a plugin backend is *not possible*. The HivraChat `getReader()`/NDJSON loop will receive one buffered chunk, not a stream. **V0 must be buffered + poll; live progress comes later via the company WS bus, not the plugin route.**
2. **`issueService.create` does NOT auto-wake the assignee on the plugin path.** The seam needs an **explicit** `ctx.issues.requestWakeup(...)` call after create (`requestWakeup` confirmed at `types.ts:1410`; capability `issues.wakeup` required). Backlog-status issues never auto-run.
3. **HivraChat.tsx is a PORT, not a reskin.** It hard-imports posthog/telemetry, StorageUsageBanner, MemoryUsageBanner, `uploadBoxFile`, `getGoal`, `requestAgentWelcomeMessage`, and its entire transport is `boxUrl` + Bearer → a VM's `/api/sessions`. Paperclip has no "box"; history lives in issue comments + `agent_task_sessions`. That's a transport rewrite. **Only `agent-adapters.ts` is genuinely drop-in** (zero-React, unit-tested — your single most portable artifact).

Also confirmed: **`ctx.assets` is not built** (`PLUGIN_SPEC.md:30`, "future-scope ideas") → HivraChat's attachment feature has no plugin path in V0. **Live-events bus is an in-process Node EventEmitter** (no Redis/cross-process) → single-box only; multi-tenant fleet = real infra you'd own. The "fully externalized adapter, zero core edits" precedent lives on **HenkDz's fork branch**, not upstream main — so treat any adapter-registry mutability / streaming seam as a *small Platform Module core edit*, not free.

---

## 1. Verdict
**Hybrid: fork the repo as a thin deploy wrapper, build the command center as an additive plugin, accept one small in-core Platform Module seam where the plugin model can't reach (live streaming / external worker adapters).** Don't greenfield — Paperclip ships the governed control plane (issues with single-assignee atomic checkout, approval gates, budget hard-stops, audit log, multi-tenant scoping, Claude Code / Codex / Cursor adapters) you'd otherwise spend months building. Don't hack core broadly — that's the merge-debt treadmill your Hermes forks already taught you. **Stay issue-backed** to stay forward-compatible with upstream's own planned CEO Chat (`doc/plans/2026-03-11-...`, which ships issue-backed Option B first and keeps a richer chat object — Option A — as "likely right after the MVP").

---

## 2. Architecture — Brain on Hands
You talk to a CEO; the CEO has no privileges of its own; every action goes through Paperclip's governed verbs (that's what buys you audit + budget + approvals for free).

```
YOU ──chat──> CEO CHAT (plugin page)
                  │  (V0: buffered POST + poll; V1: + company WS for live)
                  ▼
            CEO BRAIN (OperatorOS persona + memory)
                  │  THE SEAM:  ctx.issues.create(...)  THEN  ctx.issues.requestWakeup(...)
                  ▼
            PAPERCLIP HANDS (control plane — never bypass)
              issues.create (issues.ts:4852) → requestWakeup → enqueueWakeup (heartbeat.ts:10099)
              carries: goal ancestry, single-assignee lock, budget hard-stop, approval gate, audit
                  │  getServerAdapter (heartbeat.ts:8962) → adapter.execute (heartbeat.ts:9001)
                  ▼
            WORKERS (your fleet): claude_local · codex · cursor · http
                  │  appendRunEvent → heartbeat_run_events ; publishLiveEvent → company bus
                  │  results → issue_comments
                  ▼
            REPORT-BACK:  V0 poll ctx.issues.listComments ;  V1 subscribe
                          /api/companies/:id/events/ws (server/src/realtime/live-events-ws.ts)
            → CEO summarizes "done" in chat
```

---

## 3. Reuse vs build (corrected)
| Capability | Reuse | Build new | Note |
|---|---|---|---|
| Brain↔UI event translation | **`agent-adapters.ts` + its test, verbatim** | nothing | The one true drop-in. ChatSink + claude/codex/generic adapters, zero React. |
| Chat UI shell | HivraChat as *reference*; cherry-pick rendering | **port**: strip posthog/telemetry/storage/memory banners; **rewrite transport** from boxUrl/token → plugin apiRoute + issue comments | Not a reskin. For V1, lean on `@paperclipai/plugin-sdk/ui` + `assistant-ui` (upstream's choice). |
| CEO persona + KB | **OperatorOS** (`SOUL.md`/`USER.md` + Hormozi KB) | a `ceo` skill forked from `skills/paperclip-board/SKILL.md`, act-then-report default | **Verify OperatorOS emits `claude -p --output-format stream-json`** or the "no new parser" claim breaks. |
| Chat→work seam | nothing | declare caps `issues.read/create/update/wakeup`, `issue.comments.read/create`; call `PluginIssuesClient.create({companyId,...})` **then `requestWakeup`** | Never raw DB writes — breaks budget/checkout/audit invariants. |
| Worker invocation | Paperclip's adapters | only an external adapter plugin if a runtime is missing | Don't re-add claude/codex in core. |
| Live streaming to chat | nothing | V0 poll; V1 WS-bus relay (small core seam) | Plugin route can't stream — confirmed. |
| Funnel analytics / Proxmox / Telegram | **don't port** | — | Hivra-infra-specific, out of scope. |

---

## 4. V0 — smallest thing that actually works (days)
**Slice:** one message → CEO brain → creates **one** issue → **one explicit requestWakeup** → one worker runs → chat **polls `listComments`** → CEO renders the result via `agent-adapters.ts`. Single company, single operator, `local_trusted`, **buffered (no live streaming)**, **no HivraChat shell yet** — minimal composer only.

**Add (all in the plugin package, scaffolded *outside* the monorepo via `paperclipai plugin init @ash/command-center`):**
1. `plugin.manifest` — a `page` slot (`routePath:"command-center"`), one `apiRoute` (JSON), caps: `issues.read/create/update/wakeup`, `issue.comments.read/create`. Pin `apiVersion`/`minimumHostVersion`.
2. `ui/lib/agent-adapters.ts` (+ test) — **ported verbatim** from `dashboard/src/lib/hivra/agent-adapters.ts`.
3. `ui/CeoChat.tsx` — minimal composer + transcript: POST `{message,sessionId}` → render the buffered reply through `getAdapter()`; poll the brain route every ~2s for new comments until the issue resolves.
4. `server/ceo-chat-route.ts` — model on `server/src/routes/board-chat.ts`: replay last N comments of a standing "Command Center" issue (memory), spawn the OperatorOS/`claude` CLI with the `ceo` skill as system prompt, **return one buffered JSON response** (not a stream). Reuse `serializeTurn`/`stripActionSignals` (prompt-injection safety).
5. `server/skills/ceo/SKILL.md` — forked from `skills/paperclip-board/SKILL.md`: create/monitor work via the seam, **act-then-report default**, only `requestConfirmation` on a real governance gate.
6. `server/seam.ts` — on "this is work": `ctx.issues.create({companyId,goalId,assigneeAgentId,title,description})` **→ `ctx.issues.requestWakeup(issueId)`**; then poll `ctx.issues.listComments` and fold results back into the reply.

**Touch in the fork (only permitted core edits, on a dated re-apply list):** `Dockerfile`/`.env`/release scripts to register the plugin path + BYO-model env + OperatorOS image. Nothing under `server/ ui/ packages/`.

**V0 done =** "Spin up a landing page for X and assign a worker" → CEO creates one issue, a Codex worker runs it, you see the result land in chat, CEO says "Shipped — here's the diff." Governed end to end, in days.

**Open items to verify before/while building:** (a) OperatorOS output format = `claude` stream-json; (b) the actor/audit stamp for the brain's plugin mutations (a CLI-spawn brain has no run identity — decide what `actorType:'plugin'` records); (c) the brain's *own* token spend is ungoverned in V0 (CLI spawn → no `cost_events`) — accept for V0, govern in V1.

---

## 5. V1 / V2
- **V1:** promote the brain to a first-class **agent row** (identity/budget/permissions) running through the heartbeat loop → kills the `local_trusted` CLI crutch, unblocks hosted/multi-user, governs the CEO's own spend. Add **live streaming** via the company WS bus. Add **durable memory** (`agent_runtime_state.stateJson` + `agent_task_sessions`) with summarization/compaction (the ~20-comment replay window is a known context cliff). Generalize chat to **any teammate / drop into threads**, one issue-backed session per thread.
- **V1.5 — autonomy defaults:** encode act-then-report in the `ceo` skill; run an AEON-style GitHub Actions loop as the always-on background operator between conversations (dry-run unless `*_LIVE=1`), reporting into the same chat.
- **V2 — the verify gate:** after any deliverable the CEO auto-spawns a **QA issue** and only declares "done" when QA passes. The gate is **two-lane**: a REQUIRED deterministic check — Playwright against the preview deploy, authenticated via Clerk's first-party `@clerk/testing` tokens, with `toHaveScreenshot` for visual regression — is authoritative and blocks "done"; an ADVISORY Midscene lane (natural-language assertions on a self-hosted / BYO vision model, allow-fail) reports fuzzy findings but never gates. Failed QA routes a `requestConfirmation` to you. (Lost Pixel was dropped: its repo is archived and the product is being sunset into Figma — `toHaveScreenshot` covers visual regression for $0. Credit-metered AI-test SaaS was rejected because a PR-cadence gate detonates the meter.) This is the enforced ground-truth gate your `hermes-full-autonomy-mode` research flagged as load-bearing — built as a first-class CEO behavior, equipped via the `qa-verify-gate` skill.

---

## 6. Fork-sync discipline
1. Treat upstream core as read-only; everything additive in the plugin; the *one* unavoidable in-core seam (streaming relay / external adapter registry) = a thin Platform Module behind a registry, allowlisted in CI.
2. Merge, don't rebase (`git remote add upstream`, merge `upstream/main` often).
3. CI guard: fail build on diffs outside the plugin package + the allowlisted seam + `Dockerfile`/release scripts.
4. Pin `apiVersion`/`minimumHostVersion`; CI against **stable AND canary** (they cut canaries ~daily) so SDK drift surfaces day-of.
5. Develop out-of-tree (CLI snapshots the SDK tarball) → the command center isn't even in the fork.
6. Dated re-apply manifest for the few infra edits; run `pnpm -r typecheck && pnpm test:run && pnpm build` before each re-baseline.
7. Coordinate in their Discord #dev before anything resembling core CEO Chat (uncoordinated core PRs may be closed) — keeps your contract converging with theirs.

---

## 7. The one decision that's genuinely yours
**Single-box self-hosted (just you) vs. hosted multi-tenant (sell it / run the fleet on it).** It doesn't change V0 — start single-box regardless; even the hosted version needs this exact seam first. It changes V1: hosted forces an external event bus + plugin distribution + cross-company isolation (the in-process EventEmitter is a hard ceiling), which is real infra upstream explicitly disclaims. Decide before V1, not before V0.
