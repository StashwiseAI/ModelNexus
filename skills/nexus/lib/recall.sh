#!/usr/bin/env bash
# recall — search ~/.modelnexus/notes.md for a query.
#
# Usage:
#   recall.sh "rate limiting"
#   recall.sh --kind decision "rate"
#   recall.sh --kind decision         # all decisions, no query
#   recall.sh --all                   # everything

set -euo pipefail

KIND=""
ALL=0
QUERY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --kind) KIND="$2"; shift 2 ;;
    --all)  ALL=1; shift ;;
    -h|--help)
      sed -n '2,9p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      QUERY="$*"
      break
      ;;
  esac
done

NOTES_FILE="${MODELNEXUS_NOTES_DIR:-$HOME/.modelnexus}/notes.md"

if [[ ! -f "$NOTES_FILE" ]]; then
  echo "(no notes yet — use note.sh to record one)"
  exit 0
fi

if [[ $ALL -eq 1 && -z "$QUERY" && -z "$KIND" ]]; then
  cat "$NOTES_FILE"
  exit 0
fi

# Filter pipeline: kind filter, then query substring match.
{
  if [[ -n "$KIND" ]]; then
    grep -F "\`$KIND\`" "$NOTES_FILE" || true
  else
    grep -E '^- \*\*' "$NOTES_FILE" || true
  fi
} | {
  if [[ -n "$QUERY" ]]; then
    grep -iF "$QUERY" || true
  else
    cat
  fi
}
