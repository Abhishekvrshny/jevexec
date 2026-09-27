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

export function jevAnswerSummary(event) {
  const signals = jevSignals(event);
  if (signals) {
    const risk = Number.isFinite(signals.risk)
      ? (["low", "medium", "high"][Math.max(0, Math.min(2, Math.round(signals.risk * 2)))] ?? "—")
      : "—";
    return {
      risk,
      review: answerLabel(signals.approval),
      authorized: answerLabel(signals.authorization),
      rules: summarizeGuardrails(signals.guardrails)
    };
  }

  const answers = jevAnswers(event);
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return { risk: "—", review: "—", authorized: "—", rules: "—" };
  }

  const riskScore = answers.risk?.score;
  const risk = Number.isFinite(riskScore)
    ? (["low", "medium", "high"][Math.max(0, Math.min(2, Math.round(riskScore)))] ?? "—")
    : "—";
  const review = answerLabel(answers.approval?.noul ?? answers.approval?.probability);
  const authorized = answerLabel(answers.authorization?.noul ?? answers.authorization?.probability);
  const guardrailAnswers = Object.entries(answers)
    .filter(([key]) => key.startsWith("guardrail_") && !key.endsWith("_approval"))
    .map(([, answer]) => answer?.noul ?? answer?.probability)
    .filter((value) => Number.isFinite(value));
  const rules = summarizeGuardrails(guardrailAnswers);
  return { risk, review, authorized, rules };
}

export function jevAnswerLines(event) {
  const signals = jevSignals(event);
  if (signals) {
    const lines = [];
    if (Number.isFinite(signals.risk)) {
      const score = signals.risk * 2;
      const risk = ["low", "medium", "high"][Math.max(0, Math.min(2, Math.round(score)))] ?? "unknown";
      lines.push(`Risk: ${risk} (${score}/2)`);
    }
    appendProbability(lines, "Human review", signals.approval);
    appendProbability(lines, "Direct authorization", signals.authorization);
    for (const rule of signals.guardrails ?? []) {
      const probability = rule?.probability;
      if (!Number.isFinite(probability)) continue;
      const compliance = probability >= 0.8 ? "follows" : probability <= 0.2 ? "conflicts" : "uncertain";
      const approvalText = Number.isFinite(rule.requiresApproval)
        ? `; approval if conflicting: ${yesNoMaybe(rule.requiresApproval)} (${percent(rule.requiresApproval)})`
        : "";
      lines.push(`Rule ${rule.id}: ${compliance} (${percent(probability)})${approvalText}`);
    }
    return lines.length ? lines : ["No recognized Jev question answers recorded."];
  }

  const answers = jevAnswers(event);
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return ["No structured Jev answers recorded."];
  }
  const lines = [];
  const riskScore = answers.risk?.score;
  if (Number.isFinite(riskScore)) {
    const risk = ["low", "medium", "high"][Math.max(0, Math.min(2, Math.round(riskScore)))] ?? "unknown";
    lines.push(`Risk: ${risk} (${riskScore}/2)`);
  }
  appendProbability(lines, "Human review", answers.approval?.noul ?? answers.approval?.probability);
  appendProbability(lines, "Direct authorization", answers.authorization?.noul ?? answers.authorization?.probability);
  for (const [key, answer] of Object.entries(answers)) {
    if (!key.startsWith("guardrail_") || key.endsWith("_approval")) continue;
    const id = key.slice("guardrail_".length);
    const probability = answer?.noul ?? answer?.probability;
    if (Number.isFinite(probability)) {
      const compliance = probability >= 0.8 ? "follows" : probability <= 0.2 ? "conflicts" : "uncertain";
      const approval = answers[`${key}_approval`]?.noul ?? answers[`${key}_approval`]?.probability;
      const approvalText = Number.isFinite(approval) ? `; approval if conflicting: ${yesNoMaybe(approval)} (${percent(approval)})` : "";
      lines.push(`Rule ${id}: ${compliance} (${percent(probability)})${approvalText}`);
    }
  }
  return lines.length ? lines : ["No recognized Jev question answers recorded."];
}

function jevAnswers(event) {
  const response = [...(event.trace ?? [])].reverse().find((item) => item?.step === "jev_response");
  const body = response?.body;
  return body && typeof body === "object" ? body.answers ?? body.results : undefined;
}

function jevSignals(event) {
  const item = [...(event.trace ?? [])].reverse().find((entry) => entry?.step === "jev_signals");
  return item?.result && typeof item.result === "object" ? item.result : undefined;
}

function summarizeGuardrails(guardrails) {
  const values = Array.isArray(guardrails)
    ? guardrails.map((rule) => typeof rule === "number" ? rule : rule?.probability).filter(Number.isFinite)
    : [];
  const counts = [
    ["pass", values.filter((value) => value >= 0.8).length],
    ["fail", values.filter((value) => value <= 0.2).length],
    ["unsure", values.filter((value) => value > 0.2 && value < 0.8).length]
  ];
  return values.length
    ? counts.filter(([, count]) => count > 0).map(([label, count]) => `${count} ${label}`).join(" ")
    : "—";
}

function appendProbability(lines, label, value) {
  if (Number.isFinite(value)) lines.push(`${label}: ${yesNoMaybe(value)} (${percent(value)})`);
}

function yesNoMaybe(value) {
  if (value >= 0.8) return "yes";
  if (value <= 0.2) return "no";
  return "maybe";
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function answerLabel(value) {
  return Number.isFinite(value) ? yesNoMaybe(value) : "—";
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
    "JEV ANSWERS",
    ...jevAnswerLines(event),
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
