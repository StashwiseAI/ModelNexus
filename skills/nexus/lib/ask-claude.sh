#!/usr/bin/env bash
# ask-claude — run a one-shot Claude CLI invocation, return clean output.
#
# Authenticates via your existing Claude Code login (Claude Pro/Max OAuth or
# ANTHROPIC_API_KEY, whichever you set up). Spawns `claude -p` in non-interactive
# mode and returns stdout.
#
# Usage:
#   ask-claude.sh "prompt text"
#   echo "long prompt" | ask-claude.sh
#   ask-claude.sh --effort low "prompt"    # claude effort: low | medium | high | xhigh | max
#   ask-claude.sh --file path "..."        # fold a file into the prompt
#
# NOTE: When spawned from inside an outer Claude Code session, this script
# explicitly does NOT pass --allow-dangerously-skip-permissions or
# --dangerously-skip-permissions. The auto-mode classifier (correctly)
# refuses nested permission bypasses, and we shouldn't be running an
# autonomous agent here anyway — we just want a quick reply.

set -euo pipefail

EFFORT=""
FILE=""
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
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \?//'
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
  echo "ask-claude: prompt required (arg or stdin)" >&2
  exit 2
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "ask-claude: \`claude\` not on PATH. install: https://docs.anthropic.com/claude-code" >&2
  exit 127
fi

# Optionally fold a file into the prompt.
if [[ -n "$FILE" ]]; then
  if [[ ! -f "$FILE" ]]; then
    echo "ask-claude: file not found: $FILE" >&2
    exit 2
  fi
  PROMPT=$(printf '%s\n\n--- file: %s ---\n%s\n--- end file ---' "$PROMPT" "$FILE" "$(cat "$FILE")")
fi

CLAUDE_ARGS=(-p)
if [[ -n "$EFFORT" ]]; then
  CLAUDE_ARGS+=(--effort "$EFFORT")
fi

# Pipe the prompt via stdin (handles arbitrarily long prompts).
printf '%s' "$PROMPT" | claude "${CLAUDE_ARGS[@]}" 2>/dev/null | sed -E $'s/\x1b\\[[0-9;]*[a-zA-Z]//g'
