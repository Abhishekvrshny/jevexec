# jevexec

Command guard for Codex and Claude Code. It checks actions locally first, then
uses Jev through OpenRouter for uncertain actions. It returns allow, ask, or
deny decisions; it does not run the checked command.

## Requirements

- Node.js 20 or newer
- Python 3 for the installer
- `OPENROUTER_API_KEY` or `JEV_API_KEY` for Jev checks

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

Set the API key in the environment used to launch Codex or Claude Code:

```sh
export OPENROUTER_API_KEY="your-key"
export JEV_MODEL="typesafe/jev-1.13" # optional
```

`JEV_BASE_URL` optionally overrides the provider URL. Credentials are read from
the environment and are not stored in jevexec's config. Set
`JEVEXEC_AUTO_UPDATE=0` to disable background update checks.

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

## Development

```sh
npm run check
npm test
./install.sh codex   # or claude, or both
```

Local `check` handles only simple known read-only commands and hard-deny cases.
Other actions are sent to Jev; if Jev is unavailable, the action is held.
