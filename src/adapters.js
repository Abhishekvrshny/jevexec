export function codexDecision(result, eventName = "PermissionRequest") {
  if (eventName === "PreToolUse") {
    if (result.decision !== "deny" && result.source !== "jev-guardrail-approval") return null;
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: result.reason
      }
    };
  }
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

export function claudeDecision(result, eventName = "PreToolUse") {
  if (eventName === "PermissionRequest") {
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
  if (result.decision === "allow" || result.decision === "unavailable") return null;
  if (result.decision === "ask" && result.source === "jev-guardrail-approval") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: result.reason } };
  }
  if (result.decision === "deny") {
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: result.reason } };
  }
  return null;
}
