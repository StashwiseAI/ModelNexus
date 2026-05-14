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

# Visual bar around each peer reply — makes the response distinct in
# transcripts so host models don't paraphrase it away.
print_peer_bar() {
  local peer="$1" role="${2:-no role}" dur="${3:-}"
  echo "══════════════════════════════════════════════════════════"
  if [[ -n "$dur" && "$dur" != "0" ]]; then
    echo "  ${peer} · ${role} · ${dur}s"
  else
    echo "  ${peer} · ${role}"
  fi
  echo "══════════════════════════════════════════════════════════"
  echo
}

print_peer_end_bar() {
  echo
  echo "══════════════════════════════════════════════════════════"
}

# Internal: invoke one peer, write outputs to ${prefix}.out / .dur / .ec / .err.
# Safe to run in a background subshell. Side-effects are confined to the
# files under ${prefix}*, so the parent can wait on all of them and then
# render bars in stable order.
__ask_one() {
  local peer="$1" role="$2" context_file="$3" effort="$4" timeout="$5" prompt="$6" prefix="$7"
  local helper="$LIB/ask-$peer.sh"
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
      if [[ -n "$role" ]]; then
        prompt=$(printf '%s\n\n%s' "$(role_preamble "$role")" "$prompt")
      fi
      ;;
    gemini)
      [[ -n "$context_file" ]] && args+=(--file "$context_file")
      if [[ -n "$role" ]]; then
        prompt=$(printf '%s\n\n%s' "$(role_preamble "$role")" "$prompt")
      fi
      ;;
  esac

  local start_ts end_ts dur ec
  start_ts=$(date +%s)
  set +e
  # `${args[@]+"${args[@]}"}` safely expands a possibly-empty array under
  # `set -u`. Necessary because macOS still ships bash 3.2.
  if command -v timeout >/dev/null 2>&1; then
    timeout --kill-after=5 "${timeout}s" "$helper" ${args[@]+"${args[@]}"} "$prompt" >"$prefix.out" 2>"$prefix.err"
    ec=$?
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout --kill-after=5 "${timeout}s" "$helper" ${args[@]+"${args[@]}"} "$prompt" >"$prefix.out" 2>"$prefix.err"
    ec=$?
  else
    "$helper" ${args[@]+"${args[@]}"} "$prompt" >"$prefix.out" 2>"$prefix.err" &
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

  echo "$dur" > "$prefix.dur"
  echo "$ec"  > "$prefix.ec"
}

cmd_ask() {
  local peers_arg=""
  local role=""
  local context_file=""
  local effort=""
  local timeout="120"
  local json=0
  local quiet=0
  local prompt=""

  peers_arg="${1:-}"
  shift || fail "ask: peer(s) required (codex | claude | gemini | comma-separated | 'all')"

  # Expand the special 'all' alias to every peer that has a helper on disk.
  if [[ "$peers_arg" == "all" ]]; then
    local all_peers=()
    for p in claude codex gemini; do
      [[ -x "$LIB/ask-$p.sh" ]] && all_peers+=("$p")
    done
    peers_arg=$(IFS=,; echo "${all_peers[*]}")
  fi

  # Parse comma-separated peer list
  IFS=',' read -ra peer_list <<< "$peers_arg"

  # Validate each peer + helper
  for p in "${peer_list[@]}"; do
    case "$p" in
      codex|claude|gemini) ;;
      *) fail "unknown peer: $p (expected codex | claude | gemini)" ;;
    esac
    [[ -x "$LIB/ask-$p.sh" ]] || fail "helper missing: $LIB/ask-$p.sh"
  done

  # Parse flags
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
  [[ -z "$prompt" ]] && fail "ask: prompt required"

  # Auto-infer role if caller didn't pass one explicitly.
  local inferred_role=""
  if [[ -z "$role" ]]; then
    inferred_role=$(infer_role "$prompt")
    if [[ -n "$inferred_role" ]]; then
      role="$inferred_role"
      [[ $quiet -eq 0 ]] && echo "nexus: auto-role=$role (override with --role)" >&2
    fi
  fi

  # Tempdir for sidecar files (one set per peer)
  local tmpdir
  tmpdir=$(mktemp -d -t nexus-ask-XXXXXX)

  # Run all peers in parallel (or sequentially if only one).
  if [[ ${#peer_list[@]} -gt 1 && $quiet -eq 0 ]]; then
    echo "nexus: asking ${#peer_list[@]} peers in parallel: ${peer_list[*]}" >&2
  fi
  local pids=()
  for p in "${peer_list[@]}"; do
    ( __ask_one "$p" "$role" "$context_file" "$effort" "$timeout" "$prompt" "$tmpdir/$p" ) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  # Emit output
  local prompt_chars=${#prompt}
  local global_ec=0

  if [[ $json -eq 1 ]]; then
    # JSON: single object if 1 peer, array if multiple
    if [[ ${#peer_list[@]} -eq 1 ]]; then
      local p="${peer_list[0]}"
      local dur=$(cat "$tmpdir/$p.dur" 2>/dev/null || echo 0)
      local ec=$(cat "$tmpdir/$p.ec" 2>/dev/null || echo 1)
      local reply=$(cat "$tmpdir/$p.out" 2>/dev/null || true)
      local escaped
      escaped=$(printf '%s' "$reply" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
      printf '{"peer":"%s","role":"%s","duration_s":%s,"exit":%s,"reply":%s}\n' \
        "$p" "${role:-}" "$dur" "$ec" "$escaped"
      [[ $ec -ne 0 ]] && global_ec=$ec
    else
      local first=1
      echo -n "["
      for p in "${peer_list[@]}"; do
        [[ $first -eq 0 ]] && echo -n ","
        first=0
        local dur=$(cat "$tmpdir/$p.dur" 2>/dev/null || echo 0)
        local ec=$(cat "$tmpdir/$p.ec" 2>/dev/null || echo 1)
        local reply=$(cat "$tmpdir/$p.out" 2>/dev/null || true)
        local escaped
        escaped=$(printf '%s' "$reply" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')
        printf '{"peer":"%s","role":"%s","duration_s":%s,"exit":%s,"reply":%s}' \
          "$p" "${role:-}" "$dur" "$ec" "$escaped"
        [[ $ec -ne 0 ]] && global_ec=$ec
      done
      echo "]"
    fi
  else
    # Bar-wrapped output, one block per peer
    for p in "${peer_list[@]}"; do
      local dur=$(cat "$tmpdir/$p.dur" 2>/dev/null || echo "")
      local ec=$(cat "$tmpdir/$p.ec" 2>/dev/null || echo 1)
      print_peer_bar "$p" "${role:-no role}" "$dur"
      if [[ $ec -eq 0 ]]; then
        cat "$tmpdir/$p.out"
      else
        local err_text
        err_text=$(cat "$tmpdir/$p.err" 2>/dev/null || true)
        if [[ $ec -eq 124 || $ec -eq 137 ]]; then
          echo "(timed out after ${timeout}s)"
        else
          echo "(error: exit $ec)"
          [[ -n "$err_text" ]] && echo "$err_text"
        fi
        global_ec=$ec
      fi
      print_peer_end_bar
      echo
    done
  fi

  # Log every call
  if [[ $quiet -eq 0 ]]; then
    for p in "${peer_list[@]}"; do
      local dur=$(cat "$tmpdir/$p.dur" 2>/dev/null || echo 0)
      local ec=$(cat "$tmpdir/$p.ec" 2>/dev/null || echo 0)
      local reply=$(cat "$tmpdir/$p.out" 2>/dev/null || true)
      log_call "$p" "$role" "$dur" "$ec" "$prompt_chars" "${#reply}"
    done
  fi

  rm -rf "$tmpdir"
  exit "$global_ec"
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
