#!/usr/bin/env bash
# nexus — single front door over the per-peer ask-*.sh helpers.
#
# Adds the cross-cutting concerns codex flagged in its critique:
#   - timeout enforcement (kill + clean error)
#   - append-only call log at ~/.modelnexus/calls.log (metadata only, no prompts)
#   - consistent exit codes (0 ok, 2 usage, 124 timeout, 127 peer missing, other = peer exit)
#   - --json output for programmatic callers
#
# Per-peer helpers under lib/ are still callable directly when you want
# the minimal path. This wrapper is the recommended invocation from SKILL.md.
#
# Usage:
#   nexus.sh ask <peer> [options] "<question>"
#   nexus.sh note <kind> "<content>"
#   nexus.sh recall [--kind <kind>] [<query>]
#   nexus.sh check
#   nexus.sh help
#
# ask options:
#   --role <role>          codex roles: reviewer | patcher | explainer | architect | <free>
#   --context-file <path>  fold a file into the prompt
#   --effort <level>       codex only: minimal | low | medium | high | xhigh (default low)
#   --timeout <seconds>    kill if peer takes longer (default 120)
#   --json                 emit JSON instead of bare reply
#   --quiet                don't write a call-log line for this invocation

set -euo pipefail

NEXUS_DIR="${NEXUS_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)}"
LIB="$NEXUS_DIR/lib"
NOTES_DIR="${MODELNEXUS_NOTES_DIR:-$HOME/.modelnexus}"
LOG_FILE="$NOTES_DIR/calls.log"
mkdir -p "$NOTES_DIR"

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \?//'
}

# Pick a role from prompt text. Used when caller doesn't pass --role.
# Returns the role name on stdout, or empty string if nothing matches.
infer_role() {
  local prompt_lower
  prompt_lower=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')

  # Patcher: explicit code-change verbs OR "diff"-shaped output requests
  if [[ "$prompt_lower" =~ ^(fix|patch|refactor|implement|apply|edit|modify|rewrite|change|update|migrate|port) ]] \
     || [[ "$prompt_lower" =~ (return only the diff|unified diff|only the patch|just the diff|return only a patch) ]]; then
    echo "patcher"; return
  fi

  # Reviewer: critique/review/bug-finding language
  if [[ "$prompt_lower" =~ (critique|review|weakness|race condition|find races|find bugs|second opinion|what.?s wrong|wrong with|honest critique|critic this|pick apart|smell) ]]; then
    echo "reviewer"; return
  fi

  # Explainer: definitional / how-does-it-work questions
  if [[ "$prompt_lower" =~ ^(what (does|is|are)|why (does|is|are)|how (does|do|is|are)|explain|describe|define|tell me about) ]]; then
    echo "explainer"; return
  fi

  # Architect: design / tradeoff / approach-choice questions
  if [[ "$prompt_lower" =~ (architecture|trade.?off|design choice|design decision|should i (use|pick|choose)|which is better|approach to|abstraction over) ]]; then
    echo "architect"; return
  fi

  echo ""
}

fail() {
  echo "nexus: $*" >&2
  exit 2
}

log_call() {
  local peer="$1" role="$2" dur="$3" exit_code="$4" prompt_chars="$5" reply_chars="$6"
  local ts
  ts=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  printf '%s peer=%s role=%s dur=%ss exit=%d prompt_chars=%d reply_chars=%d\n' \
    "$ts" "$peer" "${role:-none}" "$dur" "$exit_code" "$prompt_chars" "$reply_chars" \
    >> "$LOG_FILE"
}

# Centralized role preambles, shared with helpers that don't have native --role.
role_preamble() {
  case "$1" in
    reviewer)  echo "You are reviewing the user's work. Be concrete and skeptical. Flag the strongest weakness first, then suggest concrete fixes. Cite line numbers or specific identifiers when applicable." ;;
    patcher)   echo "You are producing a precise patch. Return ONLY a unified diff (or full replacement file if simpler). No prose, no explanation, no markdown fences around the diff." ;;
    explainer) echo "You are explaining concepts. Be terse, accurate, structured. Lead with the answer, follow with the 'why' in 1-2 sentences. No filler." ;;
    architect) echo "You are evaluating an architectural choice. Identify the strongest objection, the strongest validation, and one concrete improvement. Be skeptical." ;;
    *)         echo "You are acting as $1." ;;
  esac
}

cmd_ask() {
  local peer=""
  local role=""
  local context_file=""
  local effort=""
  local timeout="120"
  local json=0
  local quiet=0
  local prompt=""

  peer="${1:-}"
  shift || fail "ask: peer required (codex | claude | gemini)"

  case "$peer" in
    codex|claude|gemini) ;;
    *) fail "unknown peer: $peer (expected codex | claude | gemini)" ;;
  esac

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --role)         role="$2"; shift 2 ;;
      --context-file) context_file="$2"; shift 2 ;;
      --effort)       effort="$2"; shift 2 ;;
      --timeout)      timeout="$2"; shift 2 ;;
      --json)         json=1; shift ;;
      --quiet)        quiet=1; shift ;;
      *)              prompt="$*"; break ;;
    esac
  done

  if [[ -z "$prompt" && ! -t 0 ]]; then
    prompt=$(cat)
  fi
  [[ -z "$prompt" ]] && fail "ask $peer: prompt required"

  local helper="$LIB/ask-$peer.sh"
  [[ -x "$helper" ]] || fail "helper missing: $helper"

  # AUTO-INFER role if caller didn't pass one explicitly.
  # Logged so the caller can see what was picked (and tune the prompt if wrong).
  local inferred_role=""
  if [[ -z "$role" ]]; then
    inferred_role=$(infer_role "$prompt")
    if [[ -n "$inferred_role" ]]; then
      role="$inferred_role"
      [[ $quiet -eq 0 ]] && echo "nexus: auto-role=$role (override with --role)" >&2
    fi
  fi

  local args=()
  case "$peer" in
    codex)
      [[ -n "$role" ]]         && args+=(--role "$role")
      [[ -n "$context_file" ]] && args+=(--file "$context_file")
      [[ -n "$effort" ]]       && args+=(--effort "$effort")
      [[ -z "$effort" ]]       && args+=(--effort low)  # default to fast for chat use
      ;;
    claude)
      [[ -n "$context_file" ]] && args+=(--file "$context_file")
      [[ -n "$effort" ]]       && args+=(--effort "$effort")
      [[ -z "$effort" ]]       && args+=(--effort low)
      # Claude has no native --role; fold the role preamble into the prompt.
      if [[ -n "$role" ]]; then
        prompt=$(printf '%s\n\n%s' "$(role_preamble "$role")" "$prompt")
      fi
      ;;
    gemini)
      [[ -n "$context_file" ]] && args+=(--file "$context_file")
      # Gemini has no native --role; fold the role preamble into the prompt.
      if [[ -n "$role" ]]; then
        prompt=$(printf '%s\n\n%s' "$(role_preamble "$role")" "$prompt")
      fi
      ;;
  esac

  local outfile errfile start_ts end_ts dur ec reply prompt_chars reply_chars
  outfile=$(mktemp -t nexus-out-XXXXXX)
  errfile=$(mktemp -t nexus-err-XXXXXX)

  start_ts=$(date +%s)
  set +e
  if command -v timeout >/dev/null 2>&1; then
    timeout --kill-after=5 "${timeout}s" "$helper" "${args[@]}" "$prompt" >"$outfile" 2>"$errfile"
    ec=$?
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout --kill-after=5 "${timeout}s" "$helper" "${args[@]}" "$prompt" >"$outfile" 2>"$errfile"
    ec=$?
  else
    # Portable fallback: background helper + watchdog that kills it after timeout.
    # `disown` keeps the watchdog from emitting its own "Terminated" message.
    "$helper" "${args[@]}" "$prompt" >"$outfile" 2>"$errfile" &
    local pid=$!
    { sleep "$timeout" && kill -TERM "$pid" 2>/dev/null && sleep 5 && kill -KILL "$pid" 2>/dev/null; } >/dev/null 2>&1 &
    local killer=$!
    disown "$killer" 2>/dev/null || true
    wait "$pid" 2>/dev/null
    ec=$?
    kill "$killer" 2>/dev/null >/dev/null 2>&1 || true
  fi
  set -e
  end_ts=$(date +%s)
  dur=$((end_ts - start_ts))

  reply=$(cat "$outfile" 2>/dev/null || true)
  local err_text
  err_text=$(cat "$errfile" 2>/dev/null || true)
  rm -f "$outfile" "$errfile"

  prompt_chars=${#prompt}
  reply_chars=${#reply}

  [[ $quiet -eq 0 ]] && log_call "$peer" "$role" "$dur" "$ec" "$prompt_chars" "$reply_chars"

  if [[ $ec -eq 124 || $ec -eq 137 ]]; then
    echo "nexus: $peer timed out after ${timeout}s" >&2
    exit 124
  fi
  if [[ $ec -ne 0 ]]; then
    echo "nexus: $peer exited $ec" >&2
    [[ -n "$err_text" ]] && printf '%s\n' "$err_text" >&2
    exit "$ec"
  fi

  if [[ $json -eq 1 ]]; then
    local escaped
    escaped=$(printf '%s' "$reply" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
    printf '{"peer":"%s","role":"%s","duration_s":%d,"exit":%d,"reply":%s}\n' \
      "$peer" "${role:-}" "$dur" "$ec" "$escaped"
  else
    printf '%s\n' "$reply"
  fi
}

cmd_note() {
  exec "$LIB/note.sh" "$@"
}

cmd_recall() {
  exec "$LIB/recall.sh" "$@"
}

cmd_check() {
  exec "$LIB/check.sh" "$@"
}

cmd_log() {
  if [[ ! -f "$LOG_FILE" ]]; then
    echo "(no calls logged yet)"
    return 0
  fi
  if [[ "${1:-}" == "--tail" ]]; then
    tail -"${2:-20}" "$LOG_FILE"
  else
    cat "$LOG_FILE"
  fi
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  ask)    cmd_ask "$@" ;;
  note)   cmd_note "$@" ;;
  recall) cmd_recall "$@" ;;
  check)  cmd_check "$@" ;;
  log)    cmd_log "$@" ;;
  help|-h|--help) usage ;;
  *) fail "unknown command: $cmd (try: ask | note | recall | check | log | help)" ;;
esac
