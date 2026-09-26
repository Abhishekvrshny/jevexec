import test from "node:test";
import assert from "node:assert/strict";
import { assess, assessLocal, combineSignals } from "../src/core.js";
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
  assert.equal(combineSignals({ risk: 0.1, approval: 0, guardrails: [{ probability: 0.1 }] }).decision, "deny");
  assert.equal(combineSignals({ risk: 0.9, approval: 0, guardrails: [] }).decision, "deny");
});

test("classifier errors remain unavailable", async () => {
  const result = await assess({ input: { command: "npm publish" }, guardrails: [] }, { evaluate: async () => { throw new Error("offline"); } });
  assert.equal(result.decision, "unavailable");
});

test("Codex passes Jev-approved results through and delegates other decisions; Claude uses native ask", () => {
  const approved = { decision: "allow", reason: "Approved" };
  const review = { decision: "ask", reason: "Review this" };
  assert.equal(codexDecision(approved), null);
  assert.equal(codexDecision(review).hookSpecificOutput.permissionDecision, "delegate");
  assert.equal(claudeDecision(review).hookSpecificOutput.permissionDecision, "ask");
});
