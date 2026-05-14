---
name: nexus
description: Confer with Claude, Codex, Gemini, or Aider inline mid-conversation without leaving the current host CLI. Use when the user asks for "a second opinion", says "ask codex", "ask claude", "check with gemini", "have aider try this", asks to compare approaches across models, or whenever a different model's strengths (e.g. Codex for precise code patches, Claude for synthesis, Gemini for long-context or vision, Aider for structured repo edits) would clearly produce a better answer than the host model alone. Also use for cross-session notes via note/recall when the user asks to "remember" or "recall" something across sessions.
---

# nexus — inline multi-model collaboration

This skill turns peer AI CLIs into inline tools you can call mid-response. Each helper runs a one-shot CLI invocation against the user's existing subscription (Claude Pro/Max for `claude`, ChatGPT Plus/Pro for `codex`, Gemini Advanced for `gemini`, BYO for `aider`) — no API keys, no daemon, no separate window. Output appears as a normal tool result in the current conversation.

## When to reach for each peer

| Peer | Reach for it when |
|---|---|
| **codex** | Precise code patches, refactors, narrow bug fixes, "show me the exact diff" requests. Strong at single-file edits with strict constraints. ~10s per call at `--effort low`. |
| **claude** | Synthesis, long-form reasoning, cross-cutting design discussion. Used as a peer when the host CLI is *not* Claude Code (e.g. when invoked from inside Codex CLI). |
| **gemini** | Long context (whole codebase summaries, large doc dumps), vision (screenshots, diagrams), web/search-context queries, multilingual work. |
| **aider** | When the task is "make these specific changes across these files and commit" and you trust aider to apply edits autonomously. Note: aider writes to the working tree by default — `nexus.sh` refuses to run it without `NEXUS_AIDER_OK=1` set. Confirm with the user before invoking. |

Don't ask the host model to consult *itself* — if you're inside Claude Code, don't `ask claude`; if you're inside Codex CLI, don't `ask codex`. The host's main thread already is that model.

## How to call (zero-flag default)

The recommended invocation is **just the peer name and the question** — no flags:

```bash
~/.claude/skills/nexus/nexus.sh ask <peer> "<question>"
```

`<peer>` is one of `codex | claude | gemini | aider`. The wrapper auto-infers the right `--role` from the prompt text (see below), defaults `--effort` to `low` for chat-style use, enforces a 120s timeout, writes a metadata-only call log to `~/.modelnexus/calls.log`, and refuses `aider` without `NEXUS_AIDER_OK=1`.

The other subcommands:

```bash
~/.claude/skills/nexus/nexus.sh note <kind> "<content>"
~/.claude/skills/nexus/nexus.sh recall [--kind <k>] [<query>]
~/.claude/skills/nexus/nexus.sh check
~/.claude/skills/nexus/nexus.sh log [--tail <n>]
```

### Auto-role inference

When `--role` isn't passed, the wrapper picks one from the prompt's leading verbs/keywords:

| Prompt looks like… | Picked role |
|---|---|
| starts with `fix / patch / refactor / implement / apply / edit / rewrite`, or asks for `unified diff` / `only the diff` | **patcher** |
| contains `critique / review / weakness / race / second opinion / what's wrong` | **reviewer** |
| starts with `what does / what is / why does / how does / explain / describe / define` | **explainer** |
| contains `architecture / tradeoff / design choice / should I use / which is better` | **architect** |
| anything else | *(no role — peer answers freeform)* |

The picked role is printed to stderr (`nexus: auto-role=... (override with --role)`) so you can see it. Pass `--role <role>` explicitly to override.

### When you DO want flags

Override anything by passing it explicitly. The full set:

| Option | Default | When to set |
|---|---|---|
| `--role <role>` | auto-inferred | The auto pick was wrong, or you want a non-standard role |
| `--context-file <path>` | none | When the question is about a specific file — peers see only what you pass them |
| `--effort <level>` | `low` | When you genuinely need slow careful reasoning: `medium / high / xhigh / max` |
| `--timeout <secs>` | `120` | Long-running peers |
| `--json` | off | Pipe the reply into another tool |
| `--quiet` | off | Skip the call-log line |

The per-peer `lib/ask-*.sh` helpers still work if you want the minimal path with no logging, timeout, or auto-inference — but prefer `nexus.sh ask` for normal use.

### Codex examples (zero-flag, auto-role)

```bash
# auto-role=explainer
~/.claude/skills/nexus/nexus.sh ask codex "What does idempotent mean?"

# auto-role=reviewer
~/.claude/skills/nexus/nexus.sh ask codex "Critique this approach: <description>"

# auto-role=patcher  (caller still needs to attach the file)
~/.claude/skills/nexus/nexus.sh ask codex --context-file src/auth.ts \
  "Fix the JWT verification path. Return only a unified diff."

# explicit override when auto-inference would pick wrong
~/.claude/skills/nexus/nexus.sh ask codex --role architect \
  "Should I use a token-bucket or a sliding-window rate limiter?"
```

Available role keywords (any other value is used as `"You are acting as <role>"`):

| Role | Reply shape it produces |
|---|---|
| `reviewer` | Skeptical critique, weakness-first |
| `patcher` | Diff-only, no prose |
| `explainer` | Terse: answer first, 1-2 sentences why |
| `architect` | One objection + one validation + one fix |

### Claude example (used as a peer from non-Claude hosts)

```bash
# From inside Codex CLI, ask Claude to synthesize across long context:
~/.claude/skills/nexus/nexus.sh ask claude "Summarize what changed across this whole PR: $(git diff main..HEAD)"
```

### Gemini examples
```bash
~/.claude/skills/nexus/nexus.sh ask gemini "Summarize what changed across these 12 commits: $(git log -p -12)"
~/.claude/skills/nexus/nexus.sh ask gemini --context-file design.md "Critique this design doc; flag unstated assumptions."
```

### Aider examples
```bash
# Aider WRITES FILES. Confirm with the user first, then set the ack flag:
NEXUS_AIDER_OK=1 ~/.claude/skills/nexus/nexus.sh ask aider \
  "Rename oldFunc to newFunc across all *.ts files and update tests."
# Both nexus.sh AND lib/ask-aider.sh refuse without NEXUS_AIDER_OK=1.
```

### note / recall (cross-session memory)
```bash
~/.claude/skills/nexus/lib/note.sh decision "We picked token-bucket over sliding-window."
~/.claude/skills/nexus/lib/note.sh finding  "Codex flagged a race on line 47 of rate_limiter.ts."
~/.claude/skills/nexus/lib/recall.sh "rate limit"
~/.claude/skills/nexus/lib/recall.sh --kind decision    # all decisions
```

Notes live at `~/.modelnexus/notes.md` (override with `MODELNEXUS_NOTES_DIR`). Use this any time the user says "remember", "we decided", "for later", or when a peer's reply contains something worth keeping across sessions.

### check (doctor)
```bash
~/.claude/skills/nexus/lib/check.sh
```
Shows which peer CLIs are on PATH and which subscription each rides on. Run this once at the start if the user reports "it doesn't work".

## Typical exchange

User: *"Fix the rate-limiter bug. Have codex draft the patch and you review it."*

```
I'll read src/rate_limiter.ts first.
[Read tool]
The issue is at line 47 — bucket.tokens decremented before quota check.
Asking codex for a precise patch.
[Bash: ~/.claude/skills/nexus/lib/ask-codex.sh --file src/rate_limiter.ts "Patch this so the quota check happens before decrement. Atomic refill+consume. Return only a unified diff."]
↳ codex returns a 9-line diff plus a note about mutex on refill.

The diff is correct. The mutex point is a good catch — adding it.
[Edit tool — apply both changes]
Done. Want me to run the tests?
```

## How to write a good peer prompt

Subprocess peers are stateless — they see nothing except what you pass them. Garbage in, shallow out. A useful prompt to a peer has four parts:

1. **Role** — what kind of answer you want (use `--role <role>` for codex; for gemini/aider, prepend it in the prompt text)
2. **Context** — relevant file(s) folded in via `--file`, or the surrounding situation in 1-2 sentences
3. **Goal + constraints** — exactly what to produce, exactly what to avoid
4. **Expected output shape** — diff? bullets? JSON? one sentence? Be explicit.

### Bad vs good

**Bad:** `ask-codex.sh "is this right?"`
→ Codex has no idea what "this" is, what "right" means, or what reply shape you want. You'll get a meandering paragraph.

**Bad:** `ask-codex.sh "review my rate limiter"`
→ Slightly better, but still no file, no specific concern, no output constraint.

**Good:**
```bash
ask-codex.sh --role reviewer --file src/rate_limiter.ts \
  "Check this file for races under concurrent burst load. List up to 3 concrete issues with line numbers; for each, one-sentence fix. No general design commentary."
```
→ Role-shaped, file-grounded, scope-bounded, output-shape-specified. Codex returns exactly what's useful.

**Good (patch request):**
```bash
ask-codex.sh --role patcher --file src/auth/middleware.ts \
  "Add JWT verification before the cookie check. Preserve the existing logging. Return only a unified diff against src/auth/middleware.ts; no prose."
```

The same shape applies to `ask-gemini.sh` (prepend the role in the prompt since `--role` is codex-only there). For aider, the prompt should be a precise change description because aider will *apply* it.

## Rules

1. **Always structure peer prompts** per the four parts above. The single biggest predictor of peer-reply quality.
2. **Don't loop on peers.** One call per question, not three. If a peer's reply needs follow-up, do the follow-up yourself or ask the user — don't ping-pong silently.
3. **Quote the peer's reply** when surfacing it in your response so the user knows what came from whom.
4. **Cite the peer in `note.sh`** when persisting their finding (e.g. `"Codex (2026-05-14): race on line 47"`).
5. **Confirm before aider** — it writes files. Don't run `ask-aider.sh` without the user okaying the autonomous edits.
6. **Default to silence** — if Claude alone has high confidence, just answer. The skill is for when a peer is genuinely the right specialist, not for every reply.

## Install

From the ModelNexus repo:
```bash
ln -s "$(pwd)/skills/nexus" ~/.claude/skills/nexus
```
Symlink (not copy) so edits to the source propagate. Claude Code will pick up the skill on next session start.

## When to NOT use this skill

- Simple lookups where Claude already has the answer.
- The user wants Claude alone, not a committee.
- Mass parallel exploration of many independent questions — use a different orchestration tool for that (the legacy ModelNexus daemon in `advanced/` is one option).
