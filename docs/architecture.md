# First implementation

The host adapters normalize a pre-execution event and translate the shared
`allow | ask | deny | unavailable` result. `src/core.js` runs explicit local
hard-deny rules first; only simple, known read-only calls can pass locally.
Active natural-language guardrails always force Jev evaluation. Uncertain
syntax, protected paths, and unknown actions go to Jev.

Provider selection is explicit through `JEV_PROVIDER`; it is never inferred
from a key or model name. OpenRouter is the default and uses
`POST /api/alpha/decisions` with `model`, serialized `state`, and typed
`questions`. TypeSafe uses `POST /v1/systemone` with the same request questions
and state, but has its own base URL, API key, and model defaults. Both adapters
normalize typed answers into the same internal risk, approval, authorization,
and guardrail signals. Provider, model, and base URL may be set in the `jev`
config object, with environment variables taking precedence. Keys remain
environment-only.

Both providers send selected command/path fields, cwd, bounded user intent, an
authorization signal, and the complete enabled guardrail set. Tool output,
file contents, credentials, and instruction files are excluded. Payloads over
the initial bound fail closed instead of dropping guardrails. Requests retry
once for HTTP 429 and 5xx responses under the same 15 second timeout.

Decisioning follows this precedence:

1. An explicit local hard-deny rule or a clear conflict with a configured user
   guardrail denies the action and returns the matching rule context.
2. Low risk, confirmed user authorization, no guardrail conflict, and no Jev
   recommendation for human review allows the action.
3. Risk, uncertain authorization or guardrail compliance, and provider
   unavailability defer to the host's normal permission prompt. A high risk
   score by itself is not a deny rule.

For Codex, explicit `allow` and `deny` results bypass the prompt; `ask` and
`unavailable` return no decision and preserve Codex's normal permission flow.
Claude Code receives native `ask` and explicit `deny` decisions; `allow` and
`unavailable` preserve its normal permission flow.

This is a first slice, not the full recommended design. Semantic memory,
project-scoped config, complete guardrail editing, host install
commands, broader shell analysis, and release calibration remain future work.
