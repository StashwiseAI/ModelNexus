#!/usr/bin/env bash
# note — append a cross-session note to ~/.modelnexus/notes.md.
#
# Usage:
#   note.sh decision "We will use token-bucket for rate limiting."
#   note.sh finding  "Codex flagged a race condition on line 47."
#   note.sh todo     "Add tests for the burst case."
#
# Kinds (free-form; suggested): decision | finding | hypothesis | question | todo

set -euo pipefail

KIND="${1:-finding}"
shift || true
CONTENT="$*"

if [[ -z "$CONTENT" && ! -t 0 ]]; then
  CONTENT=$(cat)
fi

if [[ -z "$CONTENT" ]]; then
  echo "note: content required" >&2
  exit 2
fi

NOTES_DIR="${MODELNEXUS_NOTES_DIR:-$HOME/.modelnexus}"
NOTES_FILE="$NOTES_DIR/notes.md"
mkdir -p "$NOTES_DIR"

if [[ ! -f "$NOTES_FILE" ]]; then
  printf '# ModelNexus notes\n\nCross-session memory. Each line: timestamp \xC2\xB7 kind \xC2\xB7 content.\n\n' > "$NOTES_FILE"
fi

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
printf -- '- **%s** · `%s` · %s\n' "$TS" "$KIND" "$CONTENT" >> "$NOTES_FILE"
echo "noted ($KIND) -> $NOTES_FILE"
