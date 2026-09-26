import { assessment } from "./types.js";
import { SafeAssessmentError } from "./types.js";

// Only simple, known read-only command forms get a local pass. This is not a shell parser.
const READ_ONLY = new Set(["pwd", "ls", "cat", "head", "tail", "wc", "rg", "grep", "git status", "git diff", "git log"]);
const HARD_DENY = [
  { pattern: /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f|--recursive\s+--force)\s+\/(?:\s|$)/, reason: "recursive forced deletion of the filesystem root" },
  { pattern: /\brm\s+[^\n]*--no-preserve-root[^\n]*\//i, reason: "deletion with --no-preserve-root" },
  { pattern: /\bchmod\s+-R\s+(?:777|a\+rwx)\s+\//i, reason: "recursive world-writable permissions on the filesystem root" },
  { pattern: /\bmkfs(?:\.[a-z0-9]+)?\b/i, reason: "filesystem formatting" },
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: "fork bomb pattern" },
  { pattern: /\b(?:dd\s+if=\S+\s+of=\/dev\/|curl\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash)\b)/i, reason: "direct device overwrite or execution of a downloaded script" }
];
const SHELL_META = /[|;&<>`\n]/;
const PROTECTED_PATH = /(?:^|[\s/])(?:\.env(?:\.[\w-]+)?|\.ssh|\.aws|\.gnupg|id_rsa|id_ed25519|credentials)(?:$|[\s/])/i;

export function assessLocal(action) {
  const command = commandText(action);
  if (!command) return null;
  const hardDeny = HARD_DENY.find(({ pattern }) => pattern.test(command));
  if (hardDeny) {
    return assessment("deny", `Denied by local hard-deny rule: ${hardDeny.reason}.`, "local-hard-deny");
  }
  if (action.guardrails?.length) return null;
  if (PROTECTED_PATH.test(command)) return null;
  if (SHELL_META.test(command)) return null;
  const words = command.trim().split(/\s+/);
  const binary = words[0];
  const key = binary === "git" ? words.slice(0, 2).join(" ") : binary;
  if (!READ_ONLY.has(key)) return null;
  const args = words.slice(binary === "git" ? 2 : 1);
  if (args.some((word) => word.startsWith("/") || word.startsWith("~") || word === ".." || word.startsWith("../"))) return null;
  const knownFlags = new Set(["-a", "-l", "-h", "-1", "-n", "-r", "-R", "-i", "-w", "-F", "-E", "-c"]);
  if (args.some((word) => word.startsWith("-") && !knownFlags.has(word))) return null;
  if (args.some((word) => word.startsWith("-") && word.length > 2)) return null;
  if (binary === "git" && args.length) return null;
  if (READ_ONLY.has(key)) {
    return assessment("allow", "Known read-only command.", "local-read-only");
  }
  return null;
}

export function combineSignals(signals, thresholds = {}, action = {}) {
  const askAt = thresholds.ask ?? 0.35;
  const deniedRule = signals.guardrails?.find((rule) => rule.probability <= 0.2);
  if (deniedRule) {
    const configuredRule = action.guardrails?.find((rule) => rule.id === deniedRule.id);
    const ruleContext = configuredRule ? ` Rule ${configuredRule.id}: “${configuredRule.text}”.` : ` Rule ${deniedRule.id}.`;
    return assessment("deny", `Denied because Jev found this action conflicts with an explicit user rule.${ruleContext}`, "jev-guardrail");
  }
  if (signals.guardrails?.some((rule) => rule.probability < 0.8)) {
    return assessment("ask", "Jev could not confirm that this action follows every active user rule; review it in the normal permission prompt.", "jev-guardrail");
  }
  if (signals.risk >= askAt || signals.approval >= 0.5 || signals.authorization < 0.8) {
    const context = signals.risk >= askAt
      ? `Jev rated this action as elevated risk (${signals.risk.toFixed(2)}).`
      : signals.approval >= 0.5
        ? "Jev recommends human review before this action."
        : "Jev could not confirm that the user directly authorized this action.";
    return assessment("ask", `${context} Continue through the normal permission prompt.`, "jev-risk");
  }
  return assessment("allow", "Jev found low risk and no explicit user-rule conflict.", "jev");
}

export async function assess(action, provider, { thresholds } = {}) {
  const local = assessLocal(action);
  if (local) return local;
  try {
    const signals = await provider.evaluate(action);
    return combineSignals(signals, thresholds, action);
  } catch (error) {
    const reason = error instanceof SafeAssessmentError ? error.message : "Jev request failed or timed out.";
    return assessment("unavailable", reason, "jev-error");
  }
}

export function commandText(action) {
  if (typeof action.input === "string") return action.input;
  if (!action.input || typeof action.input !== "object") return "";
  for (const key of ["command", "cmd", "script"]) {
    if (typeof action.input[key] === "string") return action.input[key];
  }
  return "";
}
