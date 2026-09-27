import test from "node:test";
import assert from "node:assert/strict";
import { decisionsEndpoint, JevProvider, redact } from "../src/jev.js";
import { assess } from "../src/core.js";

test("OpenRouter base URLs resolve to API Lens JEv decisions endpoint", () => {
  assert.equal(decisionsEndpoint("https://openrouter.ai"), "https://openrouter.ai/api/alpha/decisions");
  assert.equal(decisionsEndpoint("https://openrouter.ai/api/v1/"), "https://openrouter.ai/api/alpha/decisions");
  assert.equal(decisionsEndpoint("https://gateway.example/api/alpha/decisions"), "https://gateway.example/api/alpha/decisions");
});

test("request redacts credential-like fields and omits file contents", async () => {
  let sent;
  const provider = new JevProvider({ apiKey: "unit-test-key", fetchImpl: async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ answers: {
      risk: { type: "score", score: 2, probabilities: { 0: 0, 1: 0, 2: 1 }, legend: { 0: "low", 1: "medium", 2: "high" } },
      approval: { type: "noul", noul: 0.05 },
      authorization: { type: "noul", noul: 0.1 },
      guardrail_g1: { type: "noul", noul: 0.95 },
      guardrail_g1_approval: { type: "noul", noul: 0.05 }
    } }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const signals = await provider.evaluate({ host: "claude", tool: "Bash", input: { command: "echo Bearer abc.def sk-or-v1-12345678901234567890", content: "private file contents" }, cwd: "/tmp/work", guardrails: [{ id: "g1", text: "Never publish" }] });
  const body = JSON.parse(sent.init.body);
  assert.equal(sent.url, "https://openrouter.ai/api/alpha/decisions");
  assert.equal(sent.init.headers.authorization, "Bearer unit-test-key");
  assert.doesNotMatch(body.state, /private file contents|abc\.def|12345678901234567890/);
  assert.equal(signals.risk, 1);
  assert.deepEqual(signals.guardrails, [{ id: "g1", probability: 0.95, requiresApproval: 0.05 }]);
});

test("rule-only Jev assessment requests optional summary answers without requiring them", async () => {
  let sent;
  const provider = new JevProvider({ apiKey: "unit-test-key", fetchImpl: async (_url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ answers: {
      guardrail_g1: { type: "noul", noul: 0.05 },
      guardrail_g1_approval: { type: "noul", noul: 0.95 }
    } }), { status: 200 });
  } });
  const signals = await provider.evaluate({ host: "codex", tool: "Bash", input: { command: "git commit" }, cwd: "/tmp/work", guardrails: [{ id: "g1", text: "Ask me before committing" }] }, { mode: "rules" });
  assert.equal("risk" in sent.questions, true);
  assert.equal("approval" in sent.questions, true);
  assert.equal("authorization" in sent.questions, true);
  assert.equal(signals.risk, undefined);
  assert.equal(signals.guardrails[0].requiresApproval, 0.95);
});

test("redacts bearer tokens and credential values", () => {
  assert.equal(redact("Authorization: Bearer abc.def and sk-or-v1-12345678901234567890"), "Authorization: Bearer [redacted] and [redacted]");
});

test("missing guardrail results fail the assessment", async () => {
  const provider = new JevProvider({ apiKey: "unit-test-key", fetchImpl: async () => new Response(JSON.stringify({ answers: {
    risk: { type: "score", score: 0 }, approval: { type: "noul", noul: 0.05 }, authorization: { type: "noul", noul: 0.1 }
  } }), { status: 200 }) });
  await assert.rejects(() => provider.evaluate({ host: "claude", tool: "Bash", input: {}, guardrails: [{ id: "g1", text: "No publish" }] }), /guardrail_g1\.noul/);
});

test("HTTP provider errors reach the CLI assessment without exposing response credentials", async () => {
  const provider = new JevProvider({ apiKey: "unit-test-key", fetchImpl: async () => new Response(
    JSON.stringify({ error: { message: "Invalid key sk-or-v1-12345678901234567890" } }), { status: 401 }
  ) });
  const result = await assess({ host: "cli", tool: "shell", input: { command: "npm publish" }, guardrails: [] }, provider);
  assert.equal(result.decision, "unavailable");
  assert.match(result.reason, /401/);
  assert.doesNotMatch(result.reason, /12345678901234567890/);
});

test("missing credentials are reported at the provider boundary", async () => {
  const result = await assess({ host: "cli", tool: "shell", input: { command: "npm publish" }, guardrails: [] }, new JevProvider({ apiKey: "" }));
  assert.equal(result.decision, "unavailable");
  assert.match(result.reason, /OPENROUTER_API_KEY or JEV_API_KEY/);
});

test("invalid assessment diagnostics name missing fields without including response data", async () => {
  const provider = new JevProvider({ apiKey: "unit-test-key", fetchImpl: async () => new Response(JSON.stringify({ answers: {
    risk: { type: "score", score: 0 }, approval: { type: "noul", noul: 0.05 }
  } }), { status: 200 }) });
  const result = await assess({ host: "cli", tool: "shell", input: { command: "npm publish" }, guardrails: [] }, provider);
  assert.match(result.reason, /authorization\.noul/);
  assert.doesNotMatch(result.reason, /unit-test-key/);
});
