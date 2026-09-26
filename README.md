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

If your network cannot establish a TLS connection to `raw.githubusercontent.com`,
use GitHub's resolved address:

```sh
curl --resolve raw.githubusercontent.com:443:185.199.108.133 -fsSL https://raw.githubusercontent.com/Abhishekvrshny/jevexec/main/install.sh | bash
```

The installer adds the `jevexec` command in `~/.local/bin` and registers hooks
for both hosts without replacing other host settings. Use `codex` or `claude`
instead of `both` to install for one host. Set `JEVEXEC_BIN_DIR` to install the
command elsewhere; that directory must be on `PATH`. Pass `uninstall` instead
of `both` to remove the hooks.

## Setup

OpenRouter is the default provider. Set `JEV_PROVIDER=typesafe` to use
TypeSafe. During installation, jevexec checks for the selected provider's key
in the current environment or private env file. If neither that key nor
`JEV_API_KEY` is configured, the installer prompts for the key before it
registers hooks and saves it to the private env file described below.

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

Keys are read from the process environment first and the private env file
second; they are never saved in the jevexec config. `JEV_API_KEY` remains a
compatibility fallback when the selected provider's key variable is unset.
Set `JEVEXEC_AUTO_UPDATE=0` to disable background update checks.

The installer stores keys in
`${XDG_CONFIG_HOME:-~/.config}/jevexec/env` (one `NAME=value` per line) with
owner-only access. It copies a key from the installer process environment when
one is already configured, and prompts only when neither the environment nor
the file has a usable key. To configure or rotate a key manually, use:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/jevexec"
chmod 700 "${XDG_CONFIG_HOME:-$HOME/.config}/jevexec"
${EDITOR:-vi} "${XDG_CONFIG_HOME:-$HOME/.config}/jevexec/env"
chmod 600 "${XDG_CONFIG_HOME:-$HOME/.config}/jevexec/env"
```

For example, the file can contain `OPENROUTER_API_KEY=...`. The hook reads it
on each invocation; variables already present in the host process take
precedence. The installer only prompts if no key for the selected provider or
`JEV_API_KEY` is configured. Uninstalling hooks never prompts for a key.

## Commands

```sh
jevexec status
jevexec check 'git status'
jevexec rules list
jevexec rules add 'Do not push to production'
jevexec rules remove <id>
jevexec rules clear
jevexec hooks install [codex|claude|both]
jevexec hooks uninstall
```

The runtime is installed in `~/.local/share/jevexec` by default. Set
`JEVEXEC_INSTALL_DIR` to change its location.

`check` assesses a command but never executes it. `status` shows the config path,
active rule count, provider key status, and model. Rules are stored in
`${XDG_CONFIG_HOME:-~/.config}/jevexec/config.json`; audit entries are written to
`audit.jsonl` beside it. Each hook or `check` invocation adds one JSONL record
with a request ID, the redacted request parameters, the JEV request and response,
HTTP retry/status details, intermediate assessment results, the final assessment,
and the response returned to the hook (or CLI). Credentials are redacted and
the audit file is restricted to owner read/write permissions.

`hooks install` registers a `PermissionRequest` hook for Codex and a
`PreToolUse` hook for Claude; pass `codex` or `claude` to install for one host.
`hooks uninstall` removes the hooks from both hosts. These commands keep the
jevexec runtime, saved rules, and audit log in place.

Jev decisioning treats explicit deny rules as decisive: matching local
hard-deny rules and clear conflicts with configured user guardrails deny the
action and include the rule context. Jev allows a low-risk action when the user
authorized it and there is no guardrail conflict or review recommendation.
Risk, uncertain authorization or rule compliance, and Jev unavailability leave
the decision to the normal host permission prompt. High risk alone is not an
explicit deny rule.

For Codex, explicit `allow` and `deny` decisions bypass the approval prompt;
`ask` and `unavailable` produce no hook decision, so Codex continues its normal
permission flow. The Codex hook runs at `PermissionRequest`, which only fires
when Codex is about to ask for approval; it does not assess tools that already
proceed without approval.

## Development

Requires Node.js 20 or newer. No dependency install is needed.
`bin/jevexec` is a Node.js launcher for `src/cli.js`, not a compiled binary.

```sh
npm run check
npm test
node bin/jevexec status
node bin/jevexec check 'git status'
```

<!-- Temporary README change for branch workflow verification. -->

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

<!-- Second temporary README change for branch workflow verification. -->
