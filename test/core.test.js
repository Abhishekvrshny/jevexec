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

test("pre-tool checks evaluate rules without requesting risk signals", async () => {
  let mode;
  const action = { input: { command: "git add -A && git commit -m save" }, guardrails: [{ id: "g1", text: "Do not git add or commit" }] };
  const result = await assessRules(action, { evaluate: async (_action, options) => {
    mode = options.mode;
    return { guardrails: [{ id: "g1", probability: 0.05, requiresApproval: 0.01 }] };
  } });
  assert.equal(mode, "rules");
  assert.equal(result.decision, "deny");
  assert.equal(result.source, "jev-guardrail");
});

test("Codex blocks approval-required conflicts in PreToolUse", () => {
  const approvalRule = { decision: "ask", source: "jev-guardrail-approval", reason: "Rule requires approval" };
  const uncertainRule = { decision: "ask", source: "jev-guardrail", reason: "Unclear rule" };
  assert.equal(codexDecision(approvalRule, "PreToolUse").hookSpecificOutput.permissionDecision, "deny");
  assert.equal(claudeDecision(approvalRule, "PreToolUse").hookSpecificOutput.permissionDecision, "ask");
  assert.equal(claudeDecision(uncertainRule, "PreToolUse"), null);
});
