# First implementation

The host adapters normalize a pre-execution event and translate the shared
`allow | ask | deny | unavailable` result. `src/core.js` runs local hard denies
first; only simple, known read-only calls can pass locally. Active
natural-language guardrails always force Jev evaluation. Uncertain syntax,
protected paths, and unknown actions go to Jev. Provider failure is
`unavailable`, which each adapter blocks.

The OpenRouter provider follows API Lens's TypeSafe decisions API shape:
`POST /api/alpha/decisions` with `model`, serialized `state`, and typed
`questions`. It sends selected command/path fields, cwd, bounded user intent,
an authorization signal, and the complete enabled guardrail set. Tool output, file contents,
credentials, and instruction files are excluded. Payloads over the initial
bound fail closed instead of dropping guardrails. The provider has one retry
for HTTP 429 and 5xx responses under the same 15 second timeout.

Codex hook `ask` results block with an explanation because this hook contract
cannot present approval. Claude Code receives the native `ask` decision.

This is a first slice, not the full recommended design. Semantic memory,
project-scoped config, complete guardrail editing, host install
commands, broader shell analysis, and release calibration remain future work.
