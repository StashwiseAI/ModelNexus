#!/usr/bin/env bash
# ask-codex — run a one-shot Codex CLI invocation, return clean output.
#
# Codex authenticates via your existing ChatGPT login (or OPENAI_API_KEY,
# depending on how you installed it). No additional config needed here.
#
# Uses codex's official --output-last-message flag to get just the final
# reply, avoiding fragile output-marker parsing (verified on codex v0.128.0).
#
# Usage:
#   ask-codex.sh "prompt text"
#   echo "long prompt" | ask-codex.sh
#   ask-codex.sh --effort low "prompt"     # lower reasoning effort = faster
#   ask-codex.sh --file path "review this" # includes file content in the prompt
#   ask-codex.sh --role reviewer "..."     # prepends a role preamble
#
# Output: just the codex reply, no banner.

set -euo pipefail

EFFORT=""
FILE=""
ROLE=""
PROMPT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --effort)
      EFFORT="$2"
      shift 2
      ;;
    --file)
      FILE="$2"
      shift 2
      ;;
    --role)
      ROLE="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,16p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      PROMPT="$*"
      break
      ;;
  esac
done

if [[ -z "$PROMPT" && ! -t 0 ]]; then
  PROMPT=$(cat)
fi

if [[ -z "$PROMPT" ]]; then
  echo "ask-codex: prompt required (arg or stdin)" >&2
  exit 2
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "ask-codex: \`codex\` not on PATH. install: https://github.com/openai/codex-cli" >&2
  exit 127
fi

# Optional role preamble.
if [[ -n "$ROLE" ]]; then
  case "$ROLE" in
    reviewer)   PREAMBLE="You are reviewing the user's work. Be concrete and skeptical. Flag the strongest weakness first, then suggest concrete fixes. Cite line numbers or specific identifiers when applicable." ;;
    patcher)    PREAMBLE="You are producing a precise patch. Return ONLY a unified diff (or full replacement file if simpler). No prose, no explanation, no markdown fences around the diff." ;;
    explainer)  PREAMBLE="You are explaining concepts. Be terse, accurate, structured. Lead with the answer, follow with the 'why' in 1-2 sentences. No filler." ;;
    architect)  PREAMBLE="You are evaluating an architectural choice. Identify the strongest objection, the strongest validation, and one concrete improvement. Be skeptical." ;;
    *)          PREAMBLE="You are acting as ${ROLE}." ;;
  esac
  PROMPT=$(printf '%s\n\n%s' "$PREAMBLE" "$PROMPT")
fi

# Optionally fold a file into the prompt.
if [[ -n "$FILE" ]]; then
  if [[ ! -f "$FILE" ]]; then
    echo "ask-codex: file not found: $FILE" >&2
    exit 2
  fi
  PROMPT=$(printf '%s\n\n--- file: %s ---\n%s\n--- end file ---' "$PROMPT" "$FILE" "$(cat "$FILE")")
fi

CODEX_ARGS=(exec --skip-git-repo-check --ephemeral)
if [[ -n "$EFFORT" ]]; then
  CODEX_ARGS+=(--config "reasoning_effort=\"$EFFORT\"")
fi

# Write the final agent message to a temp file, throw away the banner.
OUTFILE=$(mktemp -t ask-codex-XXXXXX)
trap 'rm -f "$OUTFILE"' EXIT

if ! codex "${CODEX_ARGS[@]}" --output-last-message "$OUTFILE" "$PROMPT" >/dev/null 2>&1; then
  EC=$?
  echo "ask-codex: codex exited $EC" >&2
  exit "$EC"
fi

# Strip ANSI codes just in case, then emit the reply.
sed -E $'s/\x1b\\[[0-9;]*[a-zA-Z]//g' < "$OUTFILE"
