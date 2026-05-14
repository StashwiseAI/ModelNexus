#!/usr/bin/env bash
# ask-aider — one-shot Aider invocation. Note: Aider is built to make
# edits to your repo by default; this wrapper runs it in --message mode
# which still applies edits unless you also pass --dry-run.
#
# SAFETY: this helper refuses to run unless NEXUS_AIDER_OK=1 is set in the
# environment. That guard exists in BOTH the front-door (nexus.sh) and here,
# so the safety property holds even if the helper is called directly.

set -euo pipefail

if [[ "${NEXUS_AIDER_OK:-}" != "1" ]]; then
  echo "ask-aider: refusing to run. Aider writes files autonomously." >&2
  echo "ask-aider: confirm with the user, then re-invoke with: NEXUS_AIDER_OK=1 ask-aider.sh \"<prompt>\"" >&2
  exit 3
fi

PROMPT="$*"
if [[ -z "$PROMPT" && ! -t 0 ]]; then
  PROMPT=$(cat)
fi

if [[ -z "$PROMPT" ]]; then
  echo "ask-aider: prompt required" >&2
  exit 2
fi

if ! command -v aider >/dev/null 2>&1; then
  echo "ask-aider: \`aider\` not on PATH. install: https://aider.chat" >&2
  exit 127
fi

aider --no-pretty --no-stream --yes-always --message "$PROMPT" 2>/dev/null | sed -E $'s/\x1b\\[[0-9;]*[a-zA-Z]//g'
