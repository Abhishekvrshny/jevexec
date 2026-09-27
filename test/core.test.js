import test from "node:test";
import assert from "node:assert/strict";
import { assess, assessLocal, assessRules, combineSignals } from "../src/core.js";
import { claudeDecision, codexDecision } from "../src/adapters.js";

test("simple read-only commands pass locally", () => {
  assert.equal(assessLocal({ input: { command: "git status" } }).decision, "allow");
  assert.equal(assessLocal({ input: { command: "cat README.md" } }).decision, "allow");
});

test("unknown flags and shell operators are sent to Jev", () => {
  assert.equal(assessLocal({ input: { command: "git status --unknown" } }), null);
  assert.equal(assessLocal({ input: { command: "cat README.md | sh" } }), null);
});

test("a hard deny is local and active natural-language guardrails disable fast pass", () => {
  assert.equal(assessLocal({ input: { command: "rm -rf /" }, guardrails: [] }).decision, "deny");
  assert.equal(assessLocal({ input: { command: "git status" }, guardrails: [{ id: "g1", text: "No git" }] }), null);
  assert.equal(assessLocal({ input: { command: "cat ~/.ssh/id_rsa" }, guardrails: [] }), null);
});

test("guardrail conflicts and high risk take precedence over low approval", () => {
  assert.equal(combineSignals({ risk: 0.1, approval: 0, guardrails: [{ probability: 0.1, requiresApproval: 0.05 }] }).decision, "deny");
  assert.equal(combineSignals({ risk: 0.9, approval: 0, authorization: 1, guardrails: [] }).decision, "ask");
  assert.equal(combineSignals({ risk: 0.1, approval: 0, authorization: 1, guardrails: [{ probability: 0.1, requiresApproval: 0.95 }] }).decision, "ask");
});

test("classifier errors remain unavailable", async () => {
  const result = await assess({ input: { command: "npm publish" }, guardrails: [] }, { evaluate: async () => { throw new Error("offline"); } });
  assert.equal(result.decision, "unavailable");
});

test("permission requests assess authorization even for locally-known read-only commands", async () => {
  let evaluated = false;
  const action = { host: "codex", tool: "Bash", input: { command: "git status" }, guardrails: [] };
  const result = await assess(action, { evaluate: async () => {
    evaluated = true;
    return { risk: 0, approval: 0.01, authorization: 0.99, guardrails: [] };
  } }, { stage: "permission" });
  assert.equal(evaluated, true);
  assert.equal(result.decision, "allow");
});

test("permission requests preserve the prompt for unauthorized or elevated-risk actions", async () => {
  const action = { host: "codex", tool: "Bash", input: { command: "git status" }, guardrails: [] };
  const unauthorized = await assess(action, { evaluate: async () => ({ risk: 0, approval: 0.01, authorization: 0.1, guardrails: [] }) }, { stage: "permission" });
  const elevated = await assess(action, { evaluate: async () => ({ risk: 0.9, approval: 0.01, authorization: 0.99, guardrails: [] }) }, { stage: "permission" });
  assert.equal(unauthorized.decision, "ask");
  assert.equal(elevated.decision, "ask");
});

test("permission assessment failures leave the host prompt in place", async () => {
  const action = { host: "codex", tool: "Bash", input: { command: "git status" }, guardrails: [] };
  const result = await assess(action, { evaluate: async () => { throw new Error("offline"); } }, { stage: "permission" });
  assert.equal(result.decision, "unavailable");
});

test("hook adapters use event-specific responses", () => {
  const approved = { decision: "allow", reason: "Approved" };
  const review = { decision: "ask", source: "jev-guardrail-approval", reason: "Review this" };
  const denied = { decision: "deny", reason: "Blocked" };
  assert.deepEqual(codexDecision(approved).hookSpecificOutput.decision, { behavior: "allow" });
  assert.equal(codexDecision(review), null);
  assert.equal(codexDecision(denied, "PreToolUse").hookSpecificOutput.permissionDecision, "deny");
  assert.equal(codexDecision(approved, "PreToolUse"), null);
  assert.equal(claudeDecision(review).hookSpecificOutput.permissionDecision, "ask");
  assert.deepEqual(claudeDecision(approved, "PermissionRequest").hookSpecificOutput.decision, { behavior: "allow" });
  assert.equal(claudeDecision(review, "PermissionRequest"), null);
});

test("pre-tool checks use only guardrail signals for their decision", async () => {
  let mode;
  const action = { input: { command: "git status" }, guardrails: [{ id: "g1", text: "Do not git add or commit" }] };
  const result = await assessRules(action, { evaluate: async (_action, options) => {
    mode = options.mode;
    return { risk: 1, approval: 0.99, authorization: 0.01, guardrails: [{ id: "g1", probability: 0.95, requiresApproval: 0.01 }] };
  } });
  assert.equal(mode, "rules");
  assert.equal(result.decision, "allow");
  assert.equal(result.source, "jev-rules");
});

test("Codex blocks approval-required conflicts in PreToolUse", () => {
  const approvalRule = { decision: "ask", source: "jev-guardrail-approval", reason: "Rule requires approval" };
  const uncertainRule = { decision: "ask", source: "jev-guardrail", reason: "Unclear rule" };
  assert.equal(codexDecision(approvalRule, "PreToolUse").hookSpecificOutput.permissionDecision, "deny");
  assert.equal(claudeDecision(approvalRule, "PreToolUse").hookSpecificOutput.permissionDecision, "ask");
  assert.equal(claudeDecision(uncertainRule, "PreToolUse"), null);
});
