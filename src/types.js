export const DECISIONS = Object.freeze(["allow", "ask", "deny", "unavailable"]);

export class SafeAssessmentError extends Error {}

export function event({ host, tool, input, cwd = process.cwd(), userIntent, guardrails = [] }) {
  return { host, tool, input, cwd, userIntent, guardrails };
}

export function assessment(decision, reason, source = "policy") {
  if (!DECISIONS.includes(decision)) throw new Error(`Invalid decision: ${decision}`);
  return { decision, reason, source };
}
