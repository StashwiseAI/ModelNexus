# ModelNexus

> A skill that lets the model you're chatting with **confer with another model inline** — no second terminal, no API keys, no setup. You're in Claude Code asking about a bug? Claude can ask Codex what it thinks, paste the reply, and keep working. You're in Codex CLI working on a refactor? Codex can ask Claude to sanity-check the plan first.

This README is written for you, the human at the keyboard. You don't run anything yourself once it's installed — you just talk to your host model normally and it reaches for peers when that would help.

---

## Install

### Step 1 — Get the code

```bash
git clone git@github.com:StashwiseAI/ModelNexus.git
```

(or with HTTPS if you don't have SSH set up: `git clone https://github.com/StashwiseAI/ModelNexus.git`)

That creates a `ModelNexus/` directory in your current location.

### Step 2 — Move into the directory

```bash
cd ModelNexus
```

Confirm you're in the right place by listing — you should see `install.sh`, `skills/`, and `README.md` at the top level:

```bash
ls
```

Expected output:
```
README.md  advanced/  capabilities.json  install.sh  package.json  skills/  teams.json  tsconfig.json
```

### Step 3 — Run the installer

```bash
./install.sh
```

That's it. The script auto-detects which host CLIs you have (Claude Code and/or Codex CLI), creates the right symlinks for each, and runs a doctor at the end showing which peer CLIs are available.

Expected output (yours will differ depending on what's installed):

```
Installing nexus skill from:
  /Users/you/ModelNexus/modelnexus/skills/nexus

  ✓ Claude Code: linked ~/.claude/skills/nexus -> ...
  ✓ Codex CLI:   linked ~/.codex/AGENTS.md -> ...

Which peer CLIs are available:
  ✓ claude          on PATH (auth: Claude Pro/Max login or ANTHROPIC_API_KEY)
  ✓ codex           on PATH (auth: ChatGPT Plus/Pro/Team or OPENAI_API_KEY)
  ✗ gemini          NOT installed
  ✗ aider           NOT installed
```

A green `✓` means installed. A red `✗` means the peer CLI isn't on your `PATH` — that's fine as long as at least one peer is available.

### Step 4 — Verify in your host CLI

Open Claude Code (or Codex CLI), and try saying:

> *Use nexus to ask codex: what does 'idempotent' mean? One sentence.*

Within ~10 seconds you should see your host model reply with Codex's answer quoted inline. If you see that, you're done.

If nothing happens or the host model says it doesn't know about nexus, **start a fresh Claude Code (or Codex CLI) session** — the skill list is loaded at session start.

### Troubleshooting

| Symptom | Fix |
|---|---|
| `./install.sh: No such file or directory` | You're in the wrong directory. Run `cd ModelNexus` (the directory `git clone` just created) and try again. |
| `Permission denied: ./install.sh` | Run `chmod +x install.sh` first, then try again. |
| `Claude Code: ~/.claude not found` | Run `claude` (the CLI) once interactively to log in. That creates `~/.claude`. Then re-run `./install.sh`. |
| `Codex CLI: codex not on PATH` | If you have ChatGPT Plus and want to use Codex, install: `npm install -g @openai/codex`. Then re-run `./install.sh`. |
| The host model doesn't seem to know about `nexus` | Quit your Claude Code / Codex CLI session and start a fresh one. Skills are loaded at session start. |
| Existing `~/.codex/AGENTS.md` blocks the link | The installer will tell you. Either remove it (`rm ~/.codex/AGENTS.md`) and re-run, or append: `cat skills/nexus/AGENTS.md >> ~/.codex/AGENTS.md`. |
| `aider install: no pipx/brew/uv on PATH` | macOS: `brew install pipx`, then re-run `./install.sh`. Linux: `python3 -m pip install --user pipx && python3 -m pipx ensurepath`, then re-run. |
| Don't want aider? | Run `./install.sh --skip-aider` (or `--skip-peers` to skip all auto-peer installs). |
| Aider needs an API key | Unlike `claude`/`codex` which use subscriptions, aider can't. After install, `export ANTHROPIC_API_KEY=...` (or `OPENAI_API_KEY=...` / `GEMINI_API_KEY=...`) in your `~/.zshrc` / `~/.bashrc`. |

The installer is **idempotent** — run it as many times as you want. It detects what's already set up and skips it.

---

## What you can now say

Below: real exchanges from a session that built this skill. The **You** lines are what you'd type to your host CLI; the **Host** lines show what comes back.

### Get a second opinion on an approach

**You** *(in Claude Code)*:
> I'm thinking of building a token-bucket rate limiter with the refill happening lazily on each request. Get a second opinion from Codex before I commit to it.

**Claude** *(replies inline, calling Codex behind the scenes)*:
> Asking Codex *(auto-role: reviewer)*…
>
> > **Codex says:**
> > - Lazy refill on each request is fine for low-contention single-process use, but races under burst load — two concurrent requests can both observe `bucket.tokens >= 1` and both pass. Add a mutex around refill+consume, or use atomic-CAS.
> > - Consider clamping `tokens` at `capacity` on refill — otherwise long idle periods will let a single client drain a huge burst at once.
>
> Codex's race-condition point is the real one. Want me to draft a mutex-guarded version, or do you have a specific concurrency primitive in mind?

### Ask Codex to patch a specific file

**You**:
> Have codex patch `src/auth.ts` so the JWT verification happens before the cookie check.

**Claude**:
> Asking Codex *(auto-role: patcher, file: src/auth.ts)*…
>
> > **Codex's diff:**
> > ```diff
> > @@
> > -  if (!req.cookies.session) return res.status(401)
> > -  const claims = verifyJWT(req.headers.authorization)
> > +  const claims = verifyJWT(req.headers.authorization)
> > +  if (!claims) return res.status(401)
> > +  if (!req.cookies.session) return res.status(401)
> >    req.user = claims.sub
> > ```
>
> Diff looks right. Applying it now. *(Edit tool runs)* Done. Want me to run the tests?

### Quick definitional question

**You**:
> What does codex think 'idempotent' means? One sentence.

**Claude**:
> *(auto-role: explainer)*
> > **Codex:** Idempotent means an operation can be repeated multiple times and still produce the same result as doing it once.

### Critique a naming choice

**You**:
> Get codex to critique this filename: `data_thingy_v2_final.json`

**Claude**:
> *(auto-role: reviewer)*
> > **Codex:** `data_thingy_v2_final.json` is vague and self-contradictory (`thingy`, `v2`, and `final` all age badly); use a domain-specific name like `customer_export_schema_v2.json` or `model_metrics_2026-05-14.json`.
>
> All three of "thingy", "v2", and "final" are smells — they signal the author didn't have a clear domain in mind. Want me to propose a naming convention for the whole directory?

### Cross-host: ask Claude from inside Codex

**You** *(in Codex CLI)*:
> Ask Claude to synthesize what changed across this whole PR.

**Codex** *(via the same skill, just from the other direction)*:
> Asking Claude…
> > **Claude:** The PR migrates rate limiting from in-memory token-buckets to Redis-backed sliding-windows, adds Lua scripting for atomic check+increment, and replaces three duplicated middleware files with a single shared module. The mutex layer in the old code is now obsolete — Redis handles atomicity.
>
> That's a clean summary. Anything you want me to drill into?

### Remember something for later

**You**:
> Remember we decided to use token-bucket, not sliding-window, because of the burst-tolerance requirement.

**Claude**:
> *(records the note)*
> > Noted: decision · token-bucket over sliding-window (burst-tolerance requirement).

Later, a week or a new session later:

**You**:
> What did we decide about rate limiting?

**Claude**:
> *(searches your notes)*
> > Decision from 2026-05-14: token-bucket over sliding-window (burst-tolerance requirement).

---

## What triggers the skill

You don't need to memorize commands. Any of these phrasings work — your host model picks up the signal and reaches for the right peer:

| You say something like… | Host calls… |
|---|---|
| "Ask codex…" / "What does codex think…" / "Have codex draft…" | Codex |
| "Ask claude…" / "Get claude's take…" *(from non-Claude hosts)* | Claude |
| "Check with gemini…" / "Have gemini summarize…" | Gemini |
| "Use aider to make these changes…" *(host will confirm first — aider writes files)* | Aider |
| "Get a second opinion on…" / "Sanity-check this with…" | Whichever peer fits best |
| "Remember…" / "We decided…" / "For later…" | Notes |
| "What did we decide about…" / "Recall…" | Search notes |

The host model also picks a **role** automatically based on what you asked — "critique" → reviewer, "fix"/"patch" → patcher, "what does X mean" → explainer, "should I use A or B" → architect. You'll see a one-line note like `(auto-role: reviewer)` so the inference is transparent.

---

## Available peers (whichever you have installed)

| Peer | Authenticates via | Best for |
|---|---|---|
| **Claude** | Claude Pro/Max login (or `ANTHROPIC_API_KEY`) | Synthesis, long-form reasoning, cross-cutting design |
| **Codex** | ChatGPT Plus/Pro/Team login (or `OPENAI_API_KEY`) | Precise patches, refactors, narrow bug fixes |
| **Gemini** | Google login (Gemini Advanced / Code Assist) | Long context, vision, web-context summaries |
| **Aider** | BYO provider key | Autonomous multi-file edits with commits |

You don't need all of them — just one peer different from your host is enough. Your host won't consult itself; if you're in Claude Code, "ask claude" is ignored; if you're in Codex CLI, "ask codex" is ignored.

---

## Tips

- **Mention specific files** in your request and the peer will see them. *"Have codex review src/auth.ts"* is much better than *"have codex review this"*.
- **Be explicit about output shape.** *"Return only the diff, no prose"* gets a clean patch; *"explain in 2 bullets"* gets 2 bullets.
- **One peer call per question.** If you want Claude to challenge Codex's reply, just say so — don't expect a silent ping-pong loop.
- **Verify peer-cited line numbers.** Reasoning models fabricate plausible-looking `file:line` refs they never actually saw. Your host model will treat them as signposts, not facts — and you should too.
- **Aider needs your okay each time.** It writes files. Your host will surface a confirmation prompt before invoking it.

---

## Under the hood (if you're curious)

The skill is a directory at `skills/nexus/` containing a `SKILL.md` (read by Claude Code), an `AGENTS.md` (read by Codex CLI), a small front-door script `nexus.sh`, and a few bash helpers under `lib/` that wrap the peer CLIs. Your host model invokes them through its `Bash` tool when one of the trigger phrases above lights up. Notes live in `~/.modelnexus/notes.md` (plain Markdown, append-only — `cat`/edit/`git` it directly).

There's also an `advanced/` directory in this repo with a heavier daemon/orchestrator from an earlier version of the project — different shape, used only if you want three or more models talking in their own multi-pane session. See [`advanced/README.md`](advanced/README.md) for details. **The skill above is the path 99% of use cases want.**

---

## Uninstall

```bash
rm ~/.claude/skills/nexus 2>/dev/null      # Claude Code
rm ~/.codex/AGENTS.md 2>/dev/null          # Codex CLI (only if it's a symlink to this repo)
```

Both are symlinks — `rm` removes the link, not the source files. Your repo is untouched.

---

## License

MIT.
