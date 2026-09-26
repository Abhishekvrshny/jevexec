#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/Abhishekvrshny/jevexec.git"
BRANCH="main"
INSTALL_DIR="${JEVEXEC_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/jevexec}"
BIN_DIR="${JEVEXEC_BIN_DIR:-$HOME/.local/bin}"
TARGET="${1:-both}"

usage() {
  cat <<'EOF'
Usage: install.sh [codex|claude|both|uninstall]

Install jevexec and register its Codex PermissionRequest and Claude PreToolUse hooks.
Set JEVEXEC_INSTALL_DIR to change where the checkout is stored.
Set JEVEXEC_BIN_DIR to change where the jevexec command is installed.
EOF
}

case "$TARGET" in
  --help|-h) usage; exit 0 ;;
  codex|claude|both|uninstall) ;;
  *) usage >&2; exit 2 ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  echo "jevexec installer requires python3 to safely merge host settings." >&2
  exit 1
fi

if [[ "$TARGET" != "uninstall" ]]; then
  PROVIDER="${JEV_PROVIDER:-openrouter}"
  case "$PROVIDER" in
    openrouter) PROVIDER_KEY_NAME="OPENROUTER_API_KEY" ;;
    typesafe) PROVIDER_KEY_NAME="TYPESAFE_API_KEY" ;;
    *) echo "Unsupported JEV_PROVIDER '$PROVIDER'; choose openrouter or typesafe." >&2; exit 2 ;;
  esac
  CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/jevexec"
  ENV_FILE="$CONFIG_DIR/env"

  if [[ -L "$ENV_FILE" ]]; then
    echo "Refusing to use a symbolic link for the jevexec key file: $ENV_FILE" >&2
    exit 1
  fi
  if [[ -e "$ENV_FILE" && ! -f "$ENV_FILE" ]]; then
    echo "The jevexec key path is not a regular file: $ENV_FILE" >&2
    exit 1
  fi
  if [[ -d "$CONFIG_DIR" ]]; then chmod 700 "$CONFIG_DIR"; fi
  if [[ -f "$ENV_FILE" ]]; then chmod 600 "$ENV_FILE"; fi

  env_file_has_key() {
    python3 - "$ENV_FILE" "$1" <<'PY'
import re
import sys
from pathlib import Path

path, name = Path(sys.argv[1]), sys.argv[2]
try:
    contents = path.read_text()
except FileNotFoundError:
    raise SystemExit(1)
except OSError:
    raise SystemExit(1)
pattern = re.compile(r"^\s*(?:export\s+)?" + re.escape(name) + r"\s*=\s*(.*?)\s*$")
for line in contents.splitlines():
    match = pattern.match(line)
    if match and match.group(1).strip("\"'"):
        raise SystemExit(0)
raise SystemExit(1)
PY
  }

  ENV_FILE_KEY_CONFIGURED=0
  if env_file_has_key "$PROVIDER_KEY_NAME" || env_file_has_key JEV_API_KEY; then
    ENV_FILE_KEY_CONFIGURED=1
  fi

  if [[ "$ENV_FILE_KEY_CONFIGURED" -eq 0 ]]; then
    if [[ -n "${!PROVIDER_KEY_NAME:-}" ]]; then
      API_KEY="${!PROVIDER_KEY_NAME}"
      API_KEY_NAME="$PROVIDER_KEY_NAME"
    elif [[ -n "${JEV_API_KEY:-}" ]]; then
      API_KEY="$JEV_API_KEY"
      API_KEY_NAME="JEV_API_KEY"
    else
      if ! { exec 9<>/dev/tty; } 2>/dev/null; then
        echo "No API key is configured for $PROVIDER. Set $PROVIDER_KEY_NAME (or JEV_API_KEY) and rerun installation." >&2
        exit 1
      fi
      echo "jevexec requires an API key for $PROVIDER before installing its hooks."
      read -r -s -p "Enter $PROVIDER_KEY_NAME: " API_KEY <&9
      printf '\n' >&9
      exec 9>&-
      API_KEY_NAME="$PROVIDER_KEY_NAME"
      if [[ -z "$API_KEY" ]]; then
        echo "No API key entered; installation stopped." >&2
        exit 1
      fi
    fi
    mkdir -p "$CONFIG_DIR"
    chmod 700 "$CONFIG_DIR"
    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    printf '%s=%s\n' "$API_KEY_NAME" "$API_KEY" >> "$ENV_FILE"
    unset API_KEY
    echo "Saved $API_KEY_NAME in $ENV_FILE with owner-only permissions."
  fi
fi

SOURCE_DIR=""
if [[ "$TARGET" != "uninstall" ]]; then
  LOCAL_DIR=""
  SCRIPT_SOURCE="${BASH_SOURCE[0]:-}"
  if [[ -n "$SCRIPT_SOURCE" && -f "$SCRIPT_SOURCE" ]]; then
    LOCAL_DIR="$(cd -- "$(dirname -- "$SCRIPT_SOURCE")" && pwd)"
  fi
  if [[ -n "${JEVEXEC_SOURCE_DIR:-}" && -f "${JEVEXEC_SOURCE_DIR}/src/cli.js" ]]; then
    SOURCE_DIR="$(cd -- "$JEVEXEC_SOURCE_DIR" && pwd)"
  elif [[ -f "$LOCAL_DIR/src/cli.js" ]]; then
    SOURCE_DIR="$LOCAL_DIR"
  else
    if ! command -v git >/dev/null 2>&1; then
      echo "jevexec installer requires git to download its runtime." >&2
      exit 1
    fi
    mkdir -p "$(dirname -- "$INSTALL_DIR")"
    if [[ -d "$INSTALL_DIR/.git" ]]; then
      git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
      if git -C "$INSTALL_DIR" merge-base HEAD FETCH_HEAD >/dev/null 2>&1; then
        git -C "$INSTALL_DIR" merge --ff-only FETCH_HEAD
      else
        if [[ -n "$(git -C "$INSTALL_DIR" status --porcelain --untracked-files=all)" ]]; then
          echo "Cannot update jevexec checkout with unrelated history because it has local changes: $INSTALL_DIR" >&2
          echo "Preserve or remove those changes, then run the installer again." >&2
          exit 1
        fi

        BACKUP_REF="refs/jevexec/backup/$(date +%Y%m%d%H%M%S)-$$"
        git -C "$INSTALL_DIR" update-ref "$BACKUP_REF" HEAD
        git -C "$INSTALL_DIR" reset --hard FETCH_HEAD
        echo "Updated jevexec after an upstream history rewrite; previous revision is preserved at $BACKUP_REF."
      fi
    elif [[ -e "$INSTALL_DIR" ]]; then
      echo "Install path exists but is not a jevexec Git checkout: $INSTALL_DIR" >&2
      exit 1
    else
      git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    fi
    SOURCE_DIR="$(cd -- "$INSTALL_DIR" && pwd)"
  fi
  if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
    echo "jevexec requires Node.js 20 or newer." >&2
    exit 1
  fi
fi

configure_host() {
  local host="$1"
  local settings
  if [[ "$host" == "codex" ]]; then
    settings="$HOME/.codex/hooks.json"
  else
    settings="$HOME/.claude/settings.json"
  fi
  python3 - "$settings" "$host" "$SOURCE_DIR" "$TARGET" <<'PY'
import json
import os
import shlex
import sys
import tempfile
from pathlib import Path

settings = Path(sys.argv[1])
host, source, action = sys.argv[2:]
source = Path(source).expanduser() if source else None

if settings.exists():
    try:
        data = json.loads(settings.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Cannot safely update {settings}: {error}")
else:
    data = {}
if not isinstance(data, dict):
    raise SystemExit(f"Cannot safely update {settings}: expected a JSON object.")

hooks = data.setdefault("hooks", {})
if not isinstance(hooks, dict):
    raise SystemExit(f"Cannot safely update {settings}: 'hooks' must be an object.")
event_names = ["PreToolUse", "PermissionRequest"] if host == "codex" else ["PreToolUse"]

def is_jevexec(hook):
    if not isinstance(hook, dict):
        return False
    command = hook.get("command")
    status = hook.get("statusMessage")
    return isinstance(command, str) and isinstance(status, str) and f"hook {host}" in command and status.startswith("jevexec:")

for event_name in event_names:
    entries = hooks.get(event_name, [])
    if not isinstance(entries, list):
        raise SystemExit(f"Cannot safely update {settings}: '{event_name}' must be an array.")
    remaining_entries = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("hooks"), list):
            remaining_entries.append(entry)
            continue
        original_handlers = entry["hooks"]
        entry["hooks"] = [hook for hook in original_handlers if not is_jevexec(hook)]
        if entry["hooks"] or len(entry["hooks"]) == len(original_handlers):
            remaining_entries.append(entry)
    entries[:] = remaining_entries

if action != "uninstall":
    command = f"node {shlex.quote(str(source / 'src' / 'cli.js'))} hook {host}"
    handler = {"type": "command", "command": command, "timeout": 20, "statusMessage": f"jevexec: assessing action"}
    event_name = "PermissionRequest" if host == "codex" else "PreToolUse"
    entries = hooks.setdefault(event_name, [])
    if not isinstance(entries, list):
        raise SystemExit(f"Cannot safely update {settings}: '{event_name}' must be an array.")
    entries.append({"matcher": ".*", "hooks": [handler]})

for event_name in event_names:
    if not hooks.get(event_name):
        hooks.pop(event_name, None)
if not hooks:
    data.pop("hooks", None)

settings.parent.mkdir(parents=True, exist_ok=True)
mode = settings.stat().st_mode & 0o777 if settings.exists() else 0o600
fd, temporary = tempfile.mkstemp(prefix=f".{settings.name}.", dir=settings.parent)
try:
    with os.fdopen(fd, "w") as output:
        json.dump(data, output, indent=2)
        output.write("\n")
    os.chmod(temporary, mode)
    os.replace(temporary, settings)
except BaseException:
    try:
        os.unlink(temporary)
    except FileNotFoundError:
        pass
    raise

print(f"{'Removed jevexec hook from' if action == 'uninstall' else 'Registered jevexec hook in'} {settings}")
PY
}

COMMAND_PATH="$BIN_DIR/jevexec"
COMMAND_TARGET="$SOURCE_DIR/bin/jevexec"
if [[ "$TARGET" != "uninstall" ]]; then
  if [[ -L "$COMMAND_PATH" ]]; then
    CURRENT_TARGET="$(readlink "$COMMAND_PATH")"
    if [[ "$CURRENT_TARGET" != "$COMMAND_TARGET" ]]; then
      echo "Refusing to replace existing jevexec command symlink: $COMMAND_PATH -> $CURRENT_TARGET" >&2
      exit 1
    fi
  elif [[ -e "$COMMAND_PATH" ]]; then
    echo "Refusing to replace existing command: $COMMAND_PATH" >&2
    exit 1
  fi
fi

case "$TARGET" in
  codex|claude) configure_host "$TARGET" ;;
  both|uninstall)
    configure_host codex
    configure_host claude
    ;;
esac

if [[ "$TARGET" == "uninstall" ]]; then
  echo "Hooks removed. The runtime checkout and saved jevexec config/audit were left in place."
else
  mkdir -p "$BIN_DIR"
  if [[ ! -L "$COMMAND_PATH" ]]; then
    ln -s "$COMMAND_TARGET" "$COMMAND_PATH"
  fi
  chmod +x "$COMMAND_TARGET"
  echo "Installed command: $COMMAND_PATH"
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "Add $BIN_DIR to PATH to run 'jevexec' directly."
  fi
  echo "jevexec installed from: $SOURCE_DIR"
  if [[ -z "${OPENROUTER_API_KEY:-}" && -z "${TYPESAFE_API_KEY:-}" && -z "${JEV_API_KEY:-}" ]]; then
    echo "Set the API key matching JEV_PROVIDER before launching Codex or Claude Code: OPENROUTER_API_KEY or TYPESAFE_API_KEY."
  fi
  if [[ -n "${JEV_PROVIDER:-}" && "${JEV_PROVIDER}" != "openrouter" && "${JEV_PROVIDER}" != "typesafe" ]]; then
    echo "Unsupported JEV_PROVIDER '${JEV_PROVIDER}'; choose openrouter or typesafe."
  fi
fi
