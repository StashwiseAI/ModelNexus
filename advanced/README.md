# ModelNexus — advanced mode (legacy orchestrator)

This directory contains the **multi-agent group-chat orchestrator** that was the original v0.1 of ModelNexus. It was demoted on 2026-05-14 because the inline-skill experience (in `../skills/nexus/`) is the right default for almost all use cases.

You probably want the skill, not this. Read [`../README.md`](../README.md) first.

## When to use the legacy mode

- You want **three or more models simultaneously brainstorming** in their own session, each independently responding via a moderator.
- You want a **shared knowledge graph** with semantic recall (sqlite-vec embeddings, entity extraction, edge linking) across many turns.
- You want **a live TUI monitor** showing each speaker in colour as the conversation unfolds.
- You want **explicit completion signals** that require ≥2 distinct models to agree before disbanding.

For everything else — debugging a bug with one peer's help, getting a second opinion on a design, asking Gemini to summarize a long doc — use the skill.

## Architecture

- `src/daemon/` — HTTP+WebSocket daemon on `:24000`, SQLite store with WAL, completion logic.
- `src/cli/orchestrator.ts` — drives turns: picks speaker, invokes runtime, captures reply.
- `src/cli/nexus.ts` — CLI commands (`nexus start/chat/invite/monitor/disband`).
- `src/cli/monitor.ts` — blessed TUI live view.
- `src/cli/mnx.ts` — shell helper for tmux-spawned agents.
- `src/runtime/` — three runtimes: `ApiRuntime` (Anthropic/OpenAI/Google SDKs), `SubprocessRuntime` (one-shot CLI per turn), `TmuxRuntime` (persistent tmux session per agent).
- `src/knowledge/` — Ledger (markdown), Vector (sqlite-vec with OpenAI embeddings, keyword fallback), KG (entity + edge tables).
- `src/routing/` — capability scoring, LLM moderator, mid-chat invite with catch-up summary.

## How to run it

```bash
cd /path/to/modelnexus
npm install
node advanced/nexus.cjs daemon &
node advanced/nexus.cjs start subscription-brainstorm --task "..."
node advanced/nexus.cjs monitor <chat-id>
```

(You can also wire it up as a global `nexus` binary by adjusting `package.json` `bin`, then `npm link`.)

## Known operational gotcha

A previous daemon process can squat on `:24000` and silently serve `/health` from its stale `MODELNEXUS_DATA_DIR`. Before debugging "daemon is up but state is weird" symptoms, always:

```bash
pkill -f "modelnexus.*src/daemon/server.ts"
lsof -ti:24000 | xargs -r kill -9
```

Then restart. A v0.2 fix (catching `httpServer.on('error')` for EADDRINUSE) is on the TODO list.

## Tests

```bash
npx vitest run advanced/tests/
```

10/10 passed at the time of demotion. They cover the message bus + cursor pagination, completion signal logic, knowledge tools, moderator routing, subprocess output-marker parsing, and a daemon HTTP integration test.
