#!/usr/bin/env bash
# ask-gemini — run a one-shot Gemini CLI invocation, return clean output.
#
# Usage:
#   ask-gemini.sh "prompt text"
#   echo "long prompt" | ask-gemini.sh
#   ask-gemini.sh --file path "summarize this"
#
# Gemini CLI authenticates via Google login (Gemini Advanced / Code Assist).

set -euo pipefail

FILE=""
PROMPT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      FILE="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \?//'
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
  echo "ask-gemini: prompt required (arg or stdin)" >&2
  exit 2
fi

if ! command -v gemini >/dev/null 2>&1; then
  echo "ask-gemini: \`gemini\` not on PATH. install: https://github.com/google-gemini/gemini-cli" >&2
  exit 127
fi

if [[ -n "$FILE" ]]; then
  if [[ ! -f "$FILE" ]]; then
    echo "ask-gemini: file not found: $FILE" >&2
    exit 2
  fi
  PROMPT=$(printf '%s\n\n--- file: %s ---\n%s\n--- end file ---' "$PROMPT" "$FILE" "$(cat "$FILE")")
fi

# Strip ANSI from output; gemini -p prints the reply directly.
gemini -p "$PROMPT" 2>/dev/null | sed -E $'s/\x1b\\[[0-9;]*[a-zA-Z]//g'
