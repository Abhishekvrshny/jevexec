# First implementation

The host adapters normalize `PreToolUse` and `PermissionRequest` events and
translate the shared `allow | ask | deny | unavailable` result. At
`PreToolUse`, `src/core.js` runs local hard-deny rules and asks Jev to evaluate
configured natural-language guardrails only. At `PermissionRequest`, Jev
evaluates risk, authorization, and guardrails together. Simple known read-only
calls can still pass locally when there are no active guardrails.

Provider selection is explicit through `JEV_PROVIDER`; it is never inferred
from a key or model name. OpenRouter is the default and uses
`POST /api/alpha/decisions` with `model`, serialized `state`, and typed
`questions`. TypeSafe uses `POST /v1/systemone` with the same request questions
and state, but has its own base URL, API key, and model defaults. Both adapters
normalize typed answers into the same internal risk, approval, authorization,
and guardrail signals. Provider, model, and base URL may be set in the `jev`
config object, with environment variables taking precedence. Keys remain
environment-only.

Both providers send selected command/path fields, cwd, bounded user intent, and
the complete enabled guardrail set. When a pre-tool guardrail check calls Jev,
the request also asks for optional risk, human-review, and authorization
summaries so the monitor can show them. Pre-tool decisions still use only the
guardrail answers, and missing optional summaries do not fail the check.
Permission requests require risk and authorization answers for decisioning.
For each guardrail, Jev reports compliance and whether its wording requires
explicit approval rather than prohibition. Tool output, file contents,
credentials, and instruction files are excluded. Payloads over the initial
bound fail closed instead of dropping guardrails. Requests retry once for HTTP
429 and 5xx responses under the same 15 second timeout.

Decisioning follows this precedence:

1. Pre-tool checks deny local hard-deny rules and clear guardrail conflicts
   whose wording prohibits the action. Approval-required conflicts ask on
   Claude and deny on Codex because Codex `PreToolUse` cannot force a prompt.
2. Uncertain pre-tool rule compliance or provider unavailability leaves the
   decision to the host's normal permission flow.
3. Permission requests deny prohibitions, preserve the prompt for approval-
   required conflicts, elevated risk, uncertain authorization or rule
   compliance, and provider unavailability. A low-risk request is allowed only
   with confirmed authorization and no rule conflict. High risk alone is not a
   deny rule.

Codex `PreToolUse` can deny but cannot return a supported `ask` decision;
`PermissionRequest` can allow, deny, or defer to the normal prompt. Claude
`PreToolUse` can deny or ask; its `PermissionRequest` can allow or deny, while
an undecided result preserves its normal permission flow.

Semantic memory, project-scoped config, richer guardrail editing, broader shell
analysis, and release calibration remain future work.
