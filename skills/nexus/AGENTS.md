# nexus — peer-model consult helpers

> **Audience: any CLI agent that reads `AGENTS.md`** (Codex CLI, future Codex-compatible hosts, etc.). The Claude Code version of this guidance lives in `SKILL.md` and is auto-loaded by Claude Code from `~/.claude/skills/nexus/SKILL.md`.

When the user asks for a **second opinion**, says *"ask claude"*, *"ask gemini"*, *"ask another model"*, *"check this with X"*, or any task where a different model's strengths would clearly produce a better answer than you alone, invoke a peer via the front-door command below. The peer's reply comes back as stdout — quote it in your response so the user sees who said what.

## Helpers

All callable via your `Bash`-equivalent tool. The single front door does the right thing with no flags:

```bash
~/.claude/skills/nexus/nexus.sh ask <peer> "<question>"
~/.claude/skills/nexus/nexus.sh ask <peer1>,<peer2> "<question>"   # group chat
~/.claude/skills/nexus/nexus.sh ask all "<question>"               # all installed peers
```

`<peer>` is one of `claude | codex | gemini`, OR a comma-separated list, OR the literal `all`. Multi-peer asks run **in parallel**. **Don't ask the host model to consult itself** — if you're Codex, don't `ask codex`; if you're Claude, don't `ask claude`.

The wrapper auto-infers role from prompt keywords, defaults effort to `low` for chat-style use, enforces a 120s timeout, writes a metadata-only call log to `~/.modelnexus/calls.log`, and wraps every reply in a visual `═══ peer · role · Xs ═══` bar. **Paste the full bar-wrapped block to the user as-is — don't paraphrase what's between the bars.**

```bash
~/.claude/skills/nexus/nexus.sh note <kind> "<content>"        # cross-session memory
~/.claude/skills/nexus/nexus.sh recall [--kind <k>] [<query>]  # search prior notes
~/.claude/skills/nexus/nexus.sh check                          # which peers are installed
~/.claude/skills/nexus/nexus.sh log [--tail <n>]               # call history
```

## Peer strengths (when you're inside Codex, your peers are claude/gemini)

| Peer | Reach for it when |
|---|---|
| **claude** | Synthesis, long-form reasoning, cross-cutting design discussion, "what's the right shape of this solution" |
| **gemini** | Long context (whole repo summaries), vision (screenshots, diagrams), web/search-context, multilingual |

## Auto-role inference (no flags needed)

The wrapper picks a role based on prompt keywords. Logged to stderr so you can see what it picked.

| Prompt looks like… | Picked role | Reply shape |
|---|---|---|
| starts with `fix / patch / refactor / implement / edit`, or asks for `unified diff` | **patcher** | Diff only, no prose |
| contains `critique / review / weakness / race / second opinion / what's wrong` | **reviewer** | Skeptical critique, weakness-first |
| starts with `what does / what is / why does / how does / explain / describe` | **explainer** | Answer first, then 1-2 sentences why |
| contains `architecture / tradeoff / design choice / should I use / which is better` | **architect** | One objection + one validation + one fix |
| anything else | *(none — freeform reply)* | |

Override with `--role <role>` when the auto pick is wrong, or `--context-file <path>` when the question concerns a specific file (peers see only what you pass them).

## Rules

1. **One call per question.** Don't loop on peers — ping-pong silently between models is rarely what the user wants.
2. **Preserve peer replies verbatim.** The bar-wrapped output is the peer's actual reply. Paste it as-is and add your reaction AFTER the closing bar — never paraphrase what's between the bars.
3. **Use multi-peer for "what do X and Y think"** or group-opinion requests. They run in parallel; you get all replies in one tool call.
4. **Verify peer-cited file:line refs.** Reasoning models often fabricate plausible-looking line numbers they never actually saw. The substantive claim may be right; the citation is a signpost, not a fact.
5. **Default to silence.** If you can answer well alone, just answer. Peers are specialists, not a committee.
6. **Don't ask the host model to consult itself.** Skip `ask claude` from Claude Code, `ask codex` from Codex CLI, etc.

## Cross-session notes

Anything worth keeping across sessions:
```bash
~/.claude/skills/nexus/nexus.sh note decision "We chose token-bucket for the rate limiter."
~/.claude/skills/nexus/nexus.sh recall "rate limit"
```

Notes live at `~/.modelnexus/notes.md` (override with `MODELNEXUS_NOTES_DIR`). It's an append-only Markdown file — `cat`/`grep`/`git`/edit it directly.

## Install (Codex-side)

This file works as part of a project's `AGENTS.md` or as a standalone block. Two ways to put it in front of Codex:

**Option A — per project**: from a project's root, append it to the existing `AGENTS.md`:
```bash
cat ~/.claude/skills/nexus/AGENTS.md >> ./AGENTS.md
```

**Option B — globally**: if your Codex setup has a personal `AGENTS.md` location (varies by version — check `codex --help`), symlink it:
```bash
ln -sf ~/.claude/skills/nexus/AGENTS.md ~/.codex/AGENTS.md
```

Either way, the bash helpers themselves only need to be on disk — they don't care which host invokes them. So as long as `~/.claude/skills/nexus/` exists and is executable, both Claude Code and Codex CLI can use it.
