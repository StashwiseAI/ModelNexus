#!/usr/bin/env bash
# check — quick doctor: which subscription CLIs are available.

set -euo pipefail

check_one() {
  local name="$1" cmd="$2" sub="$3"
  if command -v "$cmd" >/dev/null 2>&1; then
    printf "  \033[32m\xE2\x9C\x93\033[0m %-15s on PATH at \`%s\` (auth: %s)\n" "$name" "$(command -v "$cmd")" "$sub"
  else
    printf "  \033[31m\xE2\x9C\x97\033[0m %-15s NOT installed (auth: %s)\n" "$name" "$sub"
  fi
}

check_one "claude" "claude" "Claude Pro/Max login or ANTHROPIC_API_KEY"
check_one "codex"  "codex"  "ChatGPT Plus/Pro/Team or OPENAI_API_KEY"
check_one "gemini" "gemini" "Google login (Gemini Advanced / Code Assist)"
check_one "aider"  "aider"  "BYO provider key"
echo
echo "Tip: this skill works as long as at least ONE peer model is installed."
echo "Inside Claude Code, \`claude\` is usually the host — you'd use codex/gemini/aider as peers."
echo "Inside Codex CLI, \`codex\` is the host — you'd use claude/gemini as peers."
