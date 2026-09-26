export function codexDecision(result) {
  if (result.decision !== "allow" && result.decision !== "deny") return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: result.decision === "deny"
        ? { behavior: "deny", message: result.reason }
        : { behavior: "allow" }
    }
  };
}

export function claudeDecision(result) {
  if (result.decision === "allow") return null;
  if (result.decision === "ask") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: result.reason } };
  }
  if (result.decision === "deny") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: result.reason } };
  }
  return null;
}
