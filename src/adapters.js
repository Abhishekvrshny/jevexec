export function codexDecision(result) {
  if (result.decision === "allow") return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "delegate"
    }
  };
}

export function claudeDecision(result) {
  if (result.decision === "allow") return null;
  if (result.decision === "ask") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: result.reason } };
  }
  return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `${result.decision}: ${result.reason}` } };
}
