#!/usr/bin/env bash
# install.sh — set up the nexus skill for whichever host CLIs you have
# installed (Claude Code and/or Codex CLI), and install Aider as a peer
# (unless --skip-aider).
#
# Run it from anywhere; the script finds its own location.
# Run it as many times as you want; it's idempotent.
#
# Flags:
#   --skip-aider     don't auto-install aider
#   --skip-peers     don't auto-install any peers (aider, etc.)
#   -h / --help      show this message

set -euo pipefail

SKIP_AIDER=0
SKIP_PEERS=0
for arg in "$@"; do
  case "$arg" in
    --skip-aider) SKIP_AIDER=1 ;;
    --skip-peers) SKIP_PEERS=1 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

# Find this script's directory (the repo root), regardless of where it's called from.
REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SKILL_DIR="$REPO/skills/nexus"

if [[ ! -d "$SKILL_DIR" ]]; then
  echo "Error: skill directory not found at $SKILL_DIR" >&2
  echo "(The install script must live next to a skills/nexus/ directory.)" >&2
  exit 1
fi

green() { printf '\033[32m%s\033[0m' "$1"; }
yellow() { printf '\033[33m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
dim()   { printf '\033[90m%s\033[0m' "$1"; }

echo "Installing nexus skill from:"
echo "  $(dim "$SKILL_DIR")"
echo

# ---------------------------------------------------------------------------
# 1. Claude Code
# ---------------------------------------------------------------------------
CC_BASE="$HOME/.claude"
CC_SKILL="$CC_BASE/skills/nexus"

if [[ -d "$CC_BASE" ]]; then
  mkdir -p "$CC_BASE/skills"

  if [[ -L "$CC_SKILL" ]]; then
    current=$(readlink "$CC_SKILL")
    if [[ "$current" == "$SKILL_DIR" ]]; then
      printf '  %s Claude Code: already installed (symlink points here)\n' "$(green '✓')"
    else
      printf '  %s Claude Code: existing symlink points elsewhere:\n        current: %s\n        wanted:  %s\n' "$(yellow '!')" "$current" "$SKILL_DIR"
      printf '        to replace: rm %s && re-run this script\n' "$CC_SKILL"
    fi
  elif [[ -e "$CC_SKILL" ]]; then
    printf '  %s Claude Code: %s already exists as a regular file/dir.\n' "$(yellow '!')" "$CC_SKILL"
    printf '        to replace: rm -rf %s && re-run this script\n' "$CC_SKILL"
  else
    ln -s "$SKILL_DIR" "$CC_SKILL"
    printf '  %s Claude Code: linked %s -> %s\n' "$(green '✓')" "$CC_SKILL" "$SKILL_DIR"
  fi
else
  printf '  %s Claude Code: ~/.claude not found; skipping.\n' "$(dim '-')"
  printf '        %s install Claude Code first, run it once to create ~/.claude, then re-run this script.\n' "$(dim 'tip:')"
fi

# ---------------------------------------------------------------------------
# 2. Codex CLI
# ---------------------------------------------------------------------------
if command -v codex >/dev/null 2>&1; then
  CODEX_BASE="$HOME/.codex"
  CODEX_AGENTS="$CODEX_BASE/AGENTS.md"
  SKILL_AGENTS="$SKILL_DIR/AGENTS.md"

  mkdir -p "$CODEX_BASE"

  if [[ -L "$CODEX_AGENTS" ]]; then
    current=$(readlink "$CODEX_AGENTS")
    if [[ "$current" == "$SKILL_AGENTS" ]]; then
      printf '  %s Codex CLI:   already installed (symlink points here)\n' "$(green '✓')"
    else
      printf '  %s Codex CLI:   existing symlink points elsewhere:\n        current: %s\n        wanted:  %s\n' "$(yellow '!')" "$current" "$SKILL_AGENTS"
      printf '        to replace: rm %s && re-run this script\n' "$CODEX_AGENTS"
    fi
  elif [[ -e "$CODEX_AGENTS" ]]; then
    # Existing AGENTS.md — don't clobber, but offer to append.
    if grep -q "nexus.sh ask" "$CODEX_AGENTS" 2>/dev/null; then
      printf '  %s Codex CLI:   ~/.codex/AGENTS.md already mentions nexus; nothing to do.\n' "$(green '✓')"
    else
      printf '  %s Codex CLI:   ~/.codex/AGENTS.md exists with other content.\n' "$(yellow '!')"
      printf '        to add nexus instructions: cat %s >> ~/.codex/AGENTS.md\n' "$SKILL_AGENTS"
    fi
  else
    ln -s "$SKILL_AGENTS" "$CODEX_AGENTS"
    printf '  %s Codex CLI:   linked ~/.codex/AGENTS.md -> %s\n' "$(green '✓')" "$SKILL_AGENTS"
  fi
else
  printf '  %s Codex CLI:   `codex` not on PATH; skipping.\n' "$(dim '-')"
  printf '        %s if you have ChatGPT Plus/Pro and want this as a host or peer, install: npm install -g @openai/codex\n' "$(dim 'tip:')"
fi

# ---------------------------------------------------------------------------
# 3. Aider (peer install — only one of the four peers that needs setup here;
# claude and codex are host CLIs you'd install separately, and gemini is
# Google's CLI install path which varies too much to automate cleanly)
# ---------------------------------------------------------------------------
install_aider() {
  if command -v aider >/dev/null 2>&1; then
    printf '  %s aider:       already installed at %s\n' "$(green '✓')" "$(command -v aider)"
    return 0
  fi

  echo
  echo "  Installing aider as a peer (~30s — bg downloads)..."

  local installer=""
  if command -v pipx >/dev/null 2>&1; then
    installer="pipx"
  elif command -v brew >/dev/null 2>&1; then
    echo "    no pipx on PATH; installing pipx via brew first..."
    if brew install pipx >/dev/null 2>&1; then
      # brew install pipx doesn't auto-ensurepath; do it now so aider lands on PATH
      pipx ensurepath >/dev/null 2>&1 || true
      installer="pipx"
    else
      printf '  %s aider:       brew install pipx failed; skipping.\n' "$(yellow '!')"
      printf '        manual: brew install pipx && pipx install aider-chat\n'
      return 0
    fi
  elif command -v uv >/dev/null 2>&1; then
    installer="uv"
  else
    printf '  %s aider:       no pipx/brew/uv on PATH. install one of these first, then re-run:\n' "$(yellow '!')"
    printf '        macOS:  brew install pipx && ./install.sh\n'
    printf '        Linux:  python3 -m pip install --user pipx && python3 -m pipx ensurepath && ./install.sh\n'
    return 0
  fi

  # Use aider's official `aider-install` package — it picks a Python version
  # that has pre-built scipy wheels (otherwise pip tries to compile scipy from
  # source and fails when gfortran isn't installed). Two-step:
  #   1. pipx install aider-install   (tiny shim)
  #   2. aider-install                 (the shim downloads + installs aider)
  case "$installer" in
    pipx)
      if ! pipx install aider-install >/dev/null 2>&1; then
        # Already installed? Re-run is fine.
        pipx install --force aider-install >/dev/null 2>&1 || {
          printf '  %s aider:       pipx install aider-install failed. try manually.\n' "$(red '✗')"
          return 0
        }
      fi
      if ! aider-install >/dev/null 2>&1; then
        printf '  %s aider:       aider-install bootstrap failed. try manually: pipx install aider-install && aider-install\n' "$(red '✗')"
        return 0
      fi
      ;;
    uv)
      if ! uv tool install aider-install >/dev/null 2>&1; then
        printf '  %s aider:       uv tool install aider-install failed. try manually.\n' "$(red '✗')"
        return 0
      fi
      if ! aider-install >/dev/null 2>&1; then
        printf '  %s aider:       aider-install bootstrap failed. try manually: uv tool install aider-install && aider-install\n' "$(red '✗')"
        return 0
      fi
      ;;
  esac

  # Re-resolve PATH (pipx/uv may have just added a new bin dir)
  hash -r 2>/dev/null || true

  if command -v aider >/dev/null 2>&1; then
    printf '  %s aider:       installed at %s\n' "$(green '✓')" "$(command -v aider)"
    printf '        %s aider needs a provider API key (Claude Pro / ChatGPT Plus subscriptions do NOT work for it).\n' "$(dim 'note:')"
    printf '              %s export ANTHROPIC_API_KEY=...   # for Claude\n' "$(dim 'set ONE of:')"
    printf '                          export OPENAI_API_KEY=...      # for GPT\n'
    printf '                          export GEMINI_API_KEY=...      # for Gemini\n'
  else
    printf '  %s aider:       installed but not yet on PATH. Try: source ~/.zshrc && which aider\n' "$(yellow '!')"
    printf '        or restart your shell, then re-run this script to confirm.\n'
  fi
}

if [[ $SKIP_PEERS -eq 0 && $SKIP_AIDER -eq 0 ]]; then
  echo
  install_aider
fi

# ---------------------------------------------------------------------------
# 4. Peer-CLI doctor
# ---------------------------------------------------------------------------
echo
echo "Which peer CLIs are available:"
"$SKILL_DIR/lib/check.sh"

echo
echo "Install done."
echo
echo "Try it: open Claude Code (or Codex CLI) and say something like:"
echo "    \"What does codex think about <some idea>?\""
echo "    \"Remember we decided to use token-bucket rate limiting.\""
echo "    \"Have codex review src/auth.ts\""
