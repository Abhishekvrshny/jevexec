import { watch as watchDirectory } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

export async function readAuditSnapshot(path) {
  let contents;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { events: [], malformedLines: 0, pendingLine: false };
    throw error;
  }

  const completeFile = contents.endsWith("\n");
  const lines = contents.split("\n");
  if (completeFile) lines.pop();
  else if (contents.length > 0) lines.pop();

  const events = [];
  let malformedLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object" && !Array.isArray(event)) events.push(event);
      else malformedLines += 1;
    } catch {
      malformedLines += 1;
    }
  }
  return { events, malformedLines, pendingLine: !completeFile && contents.length > 0 };
}

export function summarizeEvents(events) {
  const summary = {
    total: events.length,
    decisions: { allow: 0, ask: 0, deny: 0, unavailable: 0, other: 0 },
    hooks: { PreToolUse: 0, PermissionRequest: 0, CLI: 0, other: 0 },
    jevEvaluations: 0
  };
  for (const event of events) {
    const decision = event.assessment?.decision;
    summary.decisions[Object.hasOwn(summary.decisions, decision) ? decision : "other"] += 1;
    const hook = event.request?.hookEventName ?? (event.request?.host === "cli" ? "CLI" : "other");
    summary.hooks[Object.hasOwn(summary.hooks, hook) ? hook : "other"] += 1;
    if (event.trace?.some((item) => item?.step === "jev_request")) summary.jevEvaluations += 1;
  }
  return summary;
}

export function watchAuditFile(path, onSnapshot, { pollMs = 1000, debounceMs = 40 } = {}) {
  let closed = false;
  let refreshTimer;
  let refreshing = false;
  let queued = false;

  const refresh = async () => {
    if (closed) return;
    if (refreshing) {
      queued = true;
      return;
    }
    refreshing = true;
    try {
      const snapshot = await readAuditSnapshot(path);
      if (!closed) onSnapshot(snapshot);
    } catch (error) {
      if (!closed) onSnapshot({ events: [], malformedLines: 0, pendingLine: false, error });
    } finally {
      refreshing = false;
      if (queued && !closed) {
        queued = false;
        void refresh();
      }
    }
  };
  const scheduleRefresh = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refresh(), debounceMs);
  };

  let watcher;
  try {
    watcher = watchDirectory(dirname(path), { persistent: false }, (_eventType, filename) => {
      if (!filename || filename.toString() === basename(path)) scheduleRefresh();
    });
    watcher.on("error", scheduleRefresh);
  } catch {
    // Polling still covers a missing config directory or unsupported watcher.
  }
  const poll = setInterval(scheduleRefresh, pollMs);
  void refresh();

  return () => {
    closed = true;
    clearTimeout(refreshTimer);
    clearInterval(poll);
    watcher?.close();
  };
}

export function eventDetailLines(event) {
  const lines = [
    `Event ${event.id ?? "(no id)"} · ${event.at ?? "time unavailable"}`,
    `Host: ${event.request?.host ?? "unknown"}    Hook: ${event.request?.hookEventName ?? "CLI"}    Tool: ${event.request?.tool ?? "unknown"}`,
    `Decision: ${event.assessment?.decision ?? "unknown"} (${event.assessment?.source ?? "no source"})`,
    `Reason: ${event.assessment?.reason ?? "No assessment reason recorded"}`,
    "",
    "REQUEST"
  ];
  lines.push(...JSON.stringify({
    parameters: event.request?.parameters,
    cwd: event.request?.cwd,
    userIntent: event.request?.userIntent,
    guardrails: event.request?.guardrails
  }, null, 2).split("\n"));
  lines.push("", "ASSESSMENT TRACE", ...JSON.stringify(event.trace ?? [], null, 2).split("\n"));
  lines.push("", "RESPONSE TO HOST", ...JSON.stringify(event.responseToHook ?? null, null, 2).split("\n"));
  return lines;
}
