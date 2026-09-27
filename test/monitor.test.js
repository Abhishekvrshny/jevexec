import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import React from "react";
import { render as renderInk } from "ink-testing-library";
import { MonitorApp } from "../src/monitor-ui.js";
import { eventDetailLines, readAuditSnapshot, summarizeEvents, watchAuditFile } from "../src/monitor-data.js";

const sample = (id, decision = "allow", hookEventName = "PreToolUse", evaluated = true) => ({
  id,
  at: "2026-09-27T10:00:00.000Z",
  request: { host: "codex", hookEventName, tool: `Tool-${id}`, parameters: { command: `command-${id}` } },
  trace: evaluated ? [{ step: "jev_request" }, { step: "jev_response", status: 200, body: { answers: {} } }] : [{ step: "local_assessment" }],
  assessment: { decision, source: "test", reason: "Example assessment" },
  responseToHook: { decision }
});

test("audit reader parses complete JSONL records and leaves a partial trailing record pending", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jevexec-monitor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "audit.jsonl");
  const first = JSON.stringify(sample("one"));
  const second = JSON.stringify(sample("two", "deny"));
  await writeFile(path, `${first}\n{bad json}\n${second.slice(0, 15)}`);

  const snapshot = await readAuditSnapshot(path);
  assert.deepEqual(snapshot.events.map(({ id }) => id), ["one"]);
  assert.equal(snapshot.malformedLines, 1);
  assert.equal(snapshot.pendingLine, true);

  await writeFile(path, second);
  const validButUnterminated = await readAuditSnapshot(path);
  assert.deepEqual(validButUnterminated.events, []);
  assert.equal(validButUnterminated.pendingLine, true);
});

test("audit reader handles a missing file and a file with a complete final line", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jevexec-monitor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "audit.jsonl");
  assert.deepEqual(await readAuditSnapshot(path), { events: [], malformedLines: 0, pendingLine: false });
  await writeFile(path, `${JSON.stringify(sample("one"))}\n`);
  const snapshot = await readAuditSnapshot(path);
  assert.deepEqual(snapshot.events.map(({ id }) => id), ["one"]);
  assert.equal(snapshot.pendingLine, false);
});

test("monitor watcher refreshes when a partial event is completed and sees file replacement", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jevexec-monitor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "audit.jsonl");
  const first = JSON.stringify(sample("one"));
  await writeFile(path, `${first.slice(0, 12)}`);
  const snapshots = [];
  const stop = watchAuditFile(path, (snapshot) => snapshots.push(snapshot), { pollMs: 40, debounceMs: 5 });
  t.after(stop);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await writeFile(path, `${first}\n`);
  await waitFor(() => snapshots.some((snapshot) => snapshot.events?.some((event) => event.id === "one")));
  await rename(path, `${path}.rotated`);
  await writeFile(path, `${JSON.stringify(sample("two", "ask", "PermissionRequest"))}\n`);

  await waitFor(() => snapshots.some((snapshot) => snapshot.events?.some((event) => event.id === "two")));
  assert.ok(snapshots.some((snapshot) => snapshot.events?.some((event) => event.id === "one")));
  assert.ok(snapshots.some((snapshot) => snapshot.events?.some((event) => event.id === "two")));
});

test("summary counts decisions, hook levels, and Jev evaluations", () => {
  const summary = summarizeEvents([
    sample("one", "allow", "PreToolUse", true),
    sample("two", "ask", "PermissionRequest", true),
    sample("three", "unavailable", "OtherHook", false)
  ]);
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.decisions, { allow: 1, ask: 1, deny: 0, unavailable: 1, other: 0 });
  assert.deepEqual(summary.hooks, { PreToolUse: 1, PermissionRequest: 1, CLI: 0, other: 1 });
  assert.equal(summary.jevEvaluations, 2);
});

test("event detail includes request, assessment trace, and response to host", () => {
  const lines = eventDetailLines(sample("one"));
  assert.ok(lines.includes("ASSESSMENT TRACE"));
  assert.ok(lines.includes("RESPONSE TO HOST"));
  assert.ok(lines.some((line) => line.includes('"command": "command-one"')));
  assert.ok(lines.some((line) => line.includes('"step": "jev_request"')));
});

test("TUI navigation selects older events, opens details, scrolls, and keeps the selected event on new arrivals", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jevexec-monitor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "audit.jsonl");
  const older = sample("older", "allow");
  older.trace = Array.from({ length: 8 }, (_unused, index) => ({ step: `trace-${index}`, result: { detail: "trace row" } }));
  await writeFile(path, `${JSON.stringify(older)}\n${JSON.stringify(sample("newer", "deny"))}\n`);
  const ui = renderInk(React.createElement(MonitorApp, { auditPath: path }));
  t.after(() => ui.unmount());

  await waitFor(() => ui.lastFrame().includes("Tool-newer"));
  ui.stdin.write("\u001b[B");
  await waitFor(() => ui.lastFrame().split("\n").some((line) => line.includes("▶") && line.includes("Tool-older")), 1500, () => ui.lastFrame());
  ui.stdin.write("\r");
  await waitFor(() => ui.lastFrame().includes("Event older"));
  ui.stdin.write("j");
  await waitFor(() => !ui.lastFrame().includes("Event older"));
  ui.stdin.write("\u001b");
  await waitFor(() => ui.lastFrame().includes("Recent events"));

  await writeFile(path, `${JSON.stringify(older)}\n${JSON.stringify(sample("newest", "ask"))}\n`);
  await waitFor(() => ui.lastFrame().includes("Tool-newest") && ui.lastFrame().split("\n").some((line) => line.includes("▶") && line.includes("Tool-older")));
  ui.stdin.write("\r");
  await waitFor(() => ui.lastFrame().includes("Event older"));
});

test("monitor reports that it needs an interactive terminal", () => {
  const configPath = join(tmpdir(), `jevexec-monitor-config-${process.pid}.json`);
  const result = spawnSync(process.execPath, ["bin/jevexec", "monitor"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, JEVEXEC_CONFIG: configPath }
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires an interactive terminal/);
});

async function waitFor(predicate, timeoutMs = 1500, diagnostic = () => "") {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.fail(`Timed out waiting for audit watcher update. ${diagnostic()}`);
}
