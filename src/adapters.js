export function codexDecision(result) {
  if (result.decision === "allow") return null;
  // Codex PreToolUse hooks can block but do not provide a native ask prompt.
  const reason = result.decision === "ask"
    ? `jevexec needs your review, but this Codex hook cannot ask. Action blocked: ${result.reason}`
    : `jevexec ${result.decision}: ${result.reason}`;
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } };
}

export function claudeDecision(result) {
  if (result.decision === "allow") return null;
  if (result.decision === "ask") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: result.reason } };
  }
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `${result.decision}: ${result.reason}` } };
}
