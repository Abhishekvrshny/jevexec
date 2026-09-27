import { SafeAssessmentError } from "./types.js";

const DEFAULT_BASE_URL = "https://openrouter.ai";
const DEFAULT_MODEL = "typesafe/jev-1.13";
const PROVIDERS = {
  openrouter: {
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    endpoint: decisionsEndpoint
  },
  typesafe: {
    apiKeyEnv: "TYPESAFE_API_KEY",
    baseUrl: "https://api.typesafe.ai",
    model: "jev-latest",
    endpoint: typesafeEndpoint
  }
};
const RISK_LEVELS = [
  "0: benign, read-only or easily reversible",
  "1: meaningful side effects or uncertain scope",
  "2: destructive, exfiltrating, credential exposing, or difficult to reverse"
];

export class JevProvider {
  constructor({ settings = {}, provider, baseUrl, apiKey, model, timeoutMs = 15_000, fetchImpl = fetch, env = process.env } = {}) {
    this.provider = provider ?? env.JEV_PROVIDER ?? settings.provider ?? "openrouter";
    this.providerConfig = PROVIDERS[this.provider];
    const apiKeyEnv = this.providerConfig?.apiKeyEnv;
    this.apiKeyEnv = apiKeyEnv;
    this.baseUrl = baseUrl ?? env.JEV_BASE_URL ?? settings.baseUrl ?? this.providerConfig?.baseUrl;
    this.apiKey = apiKey ?? (apiKeyEnv ? env[apiKeyEnv] : undefined) ?? env.JEV_API_KEY;
    this.model = model ?? env.JEV_MODEL ?? settings.model ?? this.providerConfig?.model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async evaluate(action, { trace = [], mode = "full" } = {}) {
    trace.push({ step: "jev_provider", provider: this.provider, model: this.model, timeoutMs: this.timeoutMs });
    if (!this.providerConfig) throw new SafeAssessmentError(`Unsupported JEV_PROVIDER '${this.provider}'; choose openrouter or typesafe.`);
    if (!this.apiKey) throw new SafeAssessmentError(`Missing API key: set ${this.apiKeyEnv} or JEV_API_KEY in the environment running jevexec.`);
    const endpoint = this.providerConfig.endpoint(this.baseUrl);
    const state = JSON.stringify({
      host: action.host,
      tool: action.tool,
      input: safeInput(action.input),
      cwd: action.cwd,
      user_intent: typeof action.userIntent === "string" ? redact(action.userIntent.slice(0, 1000)) : undefined,
      user_guardrails: action.guardrails.map(({ id, text }) => ({ id, text: redact(text) }))
    });
    const questions = mode === "rules" ? {} : {
      risk: { type: "score", instructions: "How harmful would carrying out this tool action be in this repository and user context? Choose the level that best fits.", criteria: RISK_LEVELS },
      approval: { type: "noul", instructions: "Should a human review this action before it runs?", criteria: { true: "A reasonable user should review or confirm it first.", false: "It is clearly safe to run without review." } },
      authorization: { type: "noul", instructions: "Did the user directly authorize this specific action in the supplied user intent? Treat missing intent as not authorized.", criteria: { true: "The user directly requested or clearly authorized this action.", false: "The user did not directly request or clearly authorize this action, or intent is unavailable." } }
    };
    for (const rule of action.guardrails) {
      questions[`guardrail_${rule.id}`] = {
        type: "noul",
        instructions: `Does the action comply with user-authored guardrail ${rule.id}? The exact rule is supplied separately in state.user_guardrails.`,
        criteria: { true: "The action follows this guardrail.", false: "The action conflicts with this guardrail." }
      };
      questions[`guardrail_${rule.id}_approval`] = {
        type: "noul",
        instructions: `If this action conflicts with user-authored guardrail ${rule.id}, does the rule's wording require asking the user before an otherwise allowed action, rather than prohibiting that action? The exact rule is supplied separately in state.user_guardrails.`,
        criteria: { true: "The rule requires the user's explicit approval before this action.", false: "The rule prohibits this action or does not require a separate approval." }
      };
    }
    const payload = JSON.stringify({ model: this.model, state, questions });
    trace.push({
      step: "jev_request",
      sent: payload.length <= 32_000,
      request: redact({
        method: "POST",
        endpoint,
        headers: { "content-type": "application/json", authorization: "Bearer [redacted]" },
        payload: JSON.parse(payload)
      })
    });
    if (payload.length > 32_000) {
      trace.push({ step: "jev_request_rejected", reason: "Payload exceeds Jev's 32,000 character request limit." });
      throw new SafeAssessmentError("Action and guardrails exceed Jev's request limit; no guardrails were omitted.");
    }
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response;
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: payload,
          signal
        });
        trace.push({ step: "jev_http_attempt", attempt: attempt + 1, status: response.status, ok: response.ok });
        if (response.ok || (response.status !== 429 && response.status < 500) || attempt === 1) break;
      }
    } catch {
      const reason = signal.aborted ? "Jev request timed out." : "Could not connect to Jev; check the endpoint and network.";
      trace.push({ step: "jev_transport_error", error: reason });
      throw new SafeAssessmentError(signal.aborted ? "Jev request timed out." : "Could not connect to Jev; check the endpoint and network.");
    }
    if (!response.ok) {
      const responseText = await response.text();
      trace.push({ step: "jev_response", status: response.status, body: safeResponseBody(responseText) });
      const detail = safeProviderDetail(responseText);
      throw new SafeAssessmentError(`Jev returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`);
    }
    let responseText;
    try {
      responseText = await response.text();
    } catch {
      trace.push({ step: "jev_response_error", status: response.status, error: "Could not read Jev response body." });
      throw new SafeAssessmentError("Could not read Jev response body.");
    }
    let body;
    try {
      body = JSON.parse(responseText);
    } catch {
      trace.push({ step: "jev_response", status: response.status, body: safeResponseBody(responseText), error: "Jev returned invalid JSON." });
      throw new SafeAssessmentError("Jev returned invalid JSON.");
    }
    trace.push({ step: "jev_response", status: response.status, body: safeResponseBody(responseText) });
    const answers = body?.answers ?? body?.results;
    const riskScore = answers?.risk?.score;
    const approval = answers?.approval?.noul ?? answers?.approval?.probability;
    const authorization = answers?.authorization?.noul ?? answers?.authorization?.probability;
    const invalid = [];
    if (mode !== "rules") {
      if (typeof riskScore !== "number" || riskScore < 0 || riskScore > RISK_LEVELS.length - 1) invalid.push("risk.score");
      if (typeof approval !== "number" || approval < 0 || approval > 1) invalid.push("approval.noul");
      if (typeof authorization !== "number" || authorization < 0 || authorization > 1) invalid.push("authorization.noul");
    }
    const guardrails = action.guardrails.map((rule) => {
      const answer = answers[`guardrail_${rule.id}`];
      const probability = answer?.noul ?? answer?.probability;
      if (typeof probability !== "number" || probability < 0 || probability > 1) invalid.push(`guardrail_${rule.id}.noul`);
      const approvalAnswer = answers[`guardrail_${rule.id}_approval`];
      const requiresApproval = approvalAnswer?.noul ?? approvalAnswer?.probability;
      if (typeof requiresApproval !== "number" || requiresApproval < 0 || requiresApproval > 1) invalid.push(`guardrail_${rule.id}_approval.noul`);
      return { id: rule.id, probability, requiresApproval };
    });
    if (invalid.length) throw new SafeAssessmentError(`Jev returned missing or invalid answer(s): ${invalid.join(", ")}.`);
    return { risk: mode === "rules" ? undefined : riskScore / (RISK_LEVELS.length - 1), approval, authorization, guardrails };
  }
}

function safeProviderDetail(body) {
  const compact = body.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  let detail = compact;
  try {
    const parsed = JSON.parse(compact);
    const error = parsed?.error;
    if (typeof error === "string") detail = error;
    else if (error && typeof error === "object") detail = error.message ?? error.detail ?? error.code ?? compact;
    else detail = parsed?.message ?? parsed?.detail ?? compact;
  } catch {
    // Keep compact text for non-JSON error pages.
  }
  return String(redact(detail)).replace(/\s+/g, " ").slice(0, 240);
}

function safeResponseBody(body) {
  try {
    return redact(JSON.parse(body));
  } catch {
    return redact(body.slice(0, 8_000));
  }
}

export function decisionsEndpoint(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/api/alpha/decisions")) return trimmed;
  if (trimmed.endsWith("/api/v1")) return `${trimmed.slice(0, -7)}/api/alpha/decisions`;
  return `${trimmed}/api/alpha/decisions`;
}

export function typesafeEndpoint(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1/systemone")) return trimmed;
  return `${trimmed}/v1/systemone`;
}

export function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/(Bearer\s+)[^\s,;]+/gi, "$1[redacted]")
      .replace(/([?&](?:api[-_]?key|access_token|token|password|secret|authorization)=)[^&#\s]+/gi, "$1[redacted]")
      .replace(/\b(?:sk-or-v1|sk|key|token)[-_][A-Za-z0-9._-]{8,}/gi, "[redacted]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /key|token|secret|password|credential|authorization/i.test(key) ? "[redacted]" : redact(item)]));
  }
  return value;
}

export function safeInput(input) {
  if (typeof input === "string") return redact(input.slice(0, 4000));
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const allowed = new Set(["command", "cmd", "script", "path", "paths", "file_path", "cwd", "url", "query", "pattern", "method", "host"]);
  const selected = Object.fromEntries(Object.entries(input)
    .filter(([key]) => allowed.has(key))
    .map(([key, value]) => [key, typeof value === "string" ? redact(value.slice(0, 4000)) : redact(value)]));
  return selected;
}
