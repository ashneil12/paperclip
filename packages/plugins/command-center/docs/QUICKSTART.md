# Quickstart — fire up Paperclip, connect a Claude Code, talk to your CEO

This is the in-tree plugin in your fork (`ashneil12/paperclip`, branch
`command-center`). Solo mode is ON by default, so **one connected Claude Code is
enough** — it runs as CEO and self-staffs every other role.

## Prerequisites
- The `claude` CLI on your PATH and logged in (the CEO brain spawns it, like
  Paperclip's own board-chat). `claude --version` should work.
- Node 22 + pnpm (you already have these).

## 1. Build the workspace (once)
From the repo root (`~/Projects/paperclip`, branch `command-center`):
```bash
pnpm install
pnpm build        # builds @paperclipai/shared, the SDK, AND this plugin → dist
```
`pnpm build` is what makes `@paperclipai/shared` + the SDK resolve to built `dist`
(so the plugin worker boots cleanly). If you ever see a "shared/src/...js not found"
error, you skipped this.

## 2. Start Paperclip (trusted-local — the mode the CEO brain needs)
```bash
pnpm dev          # API at http://localhost:3100, embedded Postgres, trusted-local loopback
```
Trusted-local is the default and is exactly what the CEO's local `claude` brain
requires. Open the UI it prints.

## 3. Install the plugin into the instance
```bash
pnpm paperclipai plugin install ./packages/plugins/command-center
pnpm paperclipai plugin list      # should show @ash/command-center → ready
```

## 4. Connect your Claude Code agent
In the Paperclip UI, create/connect a **Claude Code** agent (this is the session
you'll talk through). Copy its **agent id**.

## 5. Point the plugin at it (the roster)
Set the plugin's instance config (UI settings page, or
`pnpm paperclipai plugin config @ash/command-center`). Use
`command-center.config.example.json` as the template — minimum:
```json
{ "roster": [ { "role": "ceo", "agentId": "<your-claude-code-agent-id>" } ] }
```
That single entry is all you need — solo mode self-staffs engineer/qa/researcher/
marketer onto the same agent, each with its own stack injected. (List them
explicitly if you want dedicated agents per role.)

## 6. Talk to your CEO
Open the **Command Center** page (the plugin's nav entry). Say:

> Build a pricing page for Hivra and QA it before shipping.

The CEO decomposes it, dispatches to the right role through the governed control
plane (every action budgeted + audited), runs the **QA verify gate** before
declaring done, and reports back — with the two sharpest next moves. Destructive or
spend-gated asks pause for your call; everything reversible, it just does.

## Autonomous mode (it keeps working while you sleep)
Queue standing objectives and let the CEO drain them, then read the morning briefing:
```bash
# add objectives to the backlog
curl -XPOST localhost:3100/api/plugins/@ash%2Fcommand-center/api/enqueue \
  -H 'content-type: application/json' -d '{"objective":"Draft the launch email sequence"}'

# process one (schedule this on a routine/cron) — or run the drain-backlog action
curl -XPOST localhost:3100/api/plugins/@ash%2Fcommand-center/api/tick

# read "while you were away"
curl localhost:3100/api/plugins/@ash%2Fcommand-center/api/briefing
```
To run it hands-off overnight, schedule the **`drain-backlog`** action (or a cron
hitting `/tick`) on whatever cadence you like.

## If something's off
- **"claude: command not found"** in a run → the CEO brain can't spawn the CLI.
  Fix PATH for the `pnpm dev` process.
- **Plugin shows `error` in `plugin list`** → `pnpm paperclipai plugin doctor @ash/command-center`.
- **Module resolution errors on boot** → re-run `pnpm build` at the repo root.
- The CEO asks too much → it only stops on real governance gates (spend ceiling,
  destructive/irreversible). Everything else it decides. Tune `src/brain/autonomy.ts`.

See `README.md` for architecture and `AGENTS.md` for the full developer guide.
