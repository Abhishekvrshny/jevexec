# jevexec

Command guard for Codex and Claude Code. It checks actions locally first, then
uses Jev through OpenRouter for uncertain actions. It returns allow, ask, or
deny decisions; it does not run the checked command.

## Requirements

- Node.js 20 or newer
- Python 3 for the installer
- `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`, depending on the selected provider

## Install

Install hooks for both hosts:

```sh
curl -fsSL https://raw.githubusercontent.com/Abhishekvrshny/jevexec/main/install.sh | bash -s -- both
```

The installer adds the `jevexec` command in `~/.local/bin` and registers hooks
for both hosts without replacing other host settings. Use `codex` or `claude`
instead of `both` to install for one host. Set `JEVEXEC_BIN_DIR` to install the
command elsewhere; that directory must be on `PATH`. Pass `uninstall` instead
of `both` to remove the hooks.

## Setup

Select a provider and set its API key in the environment used to launch Codex
or Claude Code. OpenRouter remains the default for existing installations:

```sh
export JEV_PROVIDER="openrouter" # or "typesafe"
export OPENROUTER_API_KEY="your-key"
```

For TypeSafe, select `typesafe` and set `TYPESAFE_API_KEY` instead. Defaults are
`typesafe/jev-1.13` on OpenRouter and `jev-latest` on TypeSafe. `JEV_MODEL`
overrides the model for either provider.

OpenRouter sends requests to `https://openrouter.ai/api/alpha/decisions` by
default. TypeSafe sends requests to `https://api.typesafe.ai/v1/systemone`.
`JEV_BASE_URL` overrides the selected provider's base URL; the provider's API
path is appended automatically.

Provider, model, and base URL can also be set in the `jev` object in the
jevexec config file. Environment variables take precedence over that file:

```json
{
  "jev": {
    "provider": "openrouter",
    "model": "typesafe/jev-1.13",
    "baseUrl": "https://openrouter.ai"
  },
  "guardrails": []
}
```

Keys are read from the environment and are never saved in the config.
`JEV_API_KEY` remains
as a compatibility fallback when the selected provider's key variable is
unset. Set `JEVEXEC_AUTO_UPDATE=0` to disable background update checks.

## Commands

```sh
jevexec status
jevexec check 'git status'
jevexec rules list
jevexec rules add 'Do not push to production'
jevexec rules remove <id>
jevexec rules clear
jevexec hooks uninstall
```

The runtime is installed in `~/.local/share/jevexec` by default. Set
`JEVEXEC_INSTALL_DIR` to change its location.

`check` assesses a command but never executes it. `status` shows the config path,
active rule count, provider key status, and model. Rules are stored in
`${XDG_CONFIG_HOME:-~/.config}/jevexec/config.json`; audit entries are written to
`audit.jsonl` beside it.

`hooks uninstall` removes jevexec's Codex and Claude `PreToolUse` hooks. It keeps
the jevexec runtime, saved rules, and audit log in place. You can reinstall the
hooks later with `install.sh both`.

For Codex, Jev-approved actions receive an explicit hook allow. Jev `ask`,
`deny`, and `unavailable` results defer to Codex's configured permission flow,
so Codex can prompt according to its normal settings.

## Development

Requires Node.js 20 or newer. No dependency install is needed.
`bin/jevexec` is a Node.js launcher for `src/cli.js`, not a compiled binary.

```sh
npm run check
npm test
node bin/jevexec status
node bin/jevexec check 'git status'
```

Tests mock provider requests and need no API key. Manual checks for uncertain
commands use Jev and need the selected provider's API key.

To try hook installation without changing your host settings, use a temporary
home directory:

```sh
tmp_home="$(mktemp -d)"
HOME="$tmp_home" XDG_CONFIG_HOME="$tmp_home/.config" \
  JEVEXEC_SOURCE_DIR="$PWD" JEVEXEC_INSTALL_DIR="$tmp_home/.local/share/jevexec" \
  JEVEXEC_BIN_DIR="$tmp_home/.local/bin" ./install.sh both
rm -rf -- "$tmp_home"
```
