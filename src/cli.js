#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { appendFile, chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assess } from "./core.js";
import { configPath, readConfig, writeConfig } from "./config.js";
import { JevProvider, redact } from "./jev.js";
import { claudeDecision, codexDecision } from "./adapters.js";
import { startUpdateCheck } from "./updater.js";
import { loadHookEnvironment } from "./env.js";
import { monitor } from "./monitor.js";

const [command, ...args] = process.argv.slice(2);
const config = await readConfig();

try {
  if (command === "hook") await hook(args[0]);
  else if (command === "check") await check(args.join(" "));
  else if (command === "rules") await rules(args);
  else if (command === "hooks") await hooks(args);
  else if (command === "monitor") await monitor(args);
  else if (command === "status") status();
  else usage();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}

async function hook(host) {
  if (host !== "codex" && host !== "claude") throw new Error("Usage: jevexec hook <codex|claude>");
  await loadHookEnvironment();
  await startUpdateCheck();
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const hookEventName = input.hook_event_name ?? (host === "codex" ? "PermissionRequest" : "PreToolUse");
  if (hookEventName !== "PreToolUse" && hookEventName !== "PermissionRequest") {
    throw new Error(`Unsupported hook event '${hookEventName}'.`);
  }
  const stage = hookEventName === "PreToolUse" ? "pretool" : "permission";
  const action = {
    host,
    tool: input.tool_name ?? "unknown",
    input: input.tool_input ?? {},
    cwd: input.cwd ?? process.cwd(),
    userIntent: input.user_prompt,
    guardrails: config.guardrails
  };
  const trace = [];
  const result = await assess(action, new JevProvider({ settings: config.jev }), { trace, stage });
  const output = host === "codex"
    ? codexDecision(result, hookEventName)
    : claudeDecision(result, hookEventName);
  await audit(action, result, { trace, hookEventName, responseToHook: output });
  if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function check(commandText) {
  if (!commandText) throw new Error("Usage: jevexec check <command>");
  const action = { host: "cli", tool: "shell", input: { command: commandText }, cwd: process.cwd(), guardrails: config.guardrails };
  const trace = [];
  const result = await assess(action, new JevProvider({ settings: config.jev }), { trace });
  const output = JSON.stringify(result, null, 2);
  await audit(action, result, { trace, responseToHook: output });
  console.log(output);
  if (result.decision === "deny" || result.decision === "unavailable") process.exitCode = 2;
}

async function rules(args) {
  const [subcommand, ...rest] = args;
  const current = await readConfig();
  if (subcommand === "list") {
    for (const rule of current.guardrails) console.log(`${rule.id}\t${rule.text}`);
    return;
  }
  if (subcommand === "add" && rest.length) {
    current.guardrails.push({ id: randomUUID(), text: rest.join(" "), enabled: true, createdAt: new Date().toISOString() });
    await writeConfig(current);
    console.log(`Saved user guardrail in ${configPath()}`);
    return;
  }
  if (subcommand === "remove" && rest[0]) {
    current.guardrails = current.guardrails.filter((rule) => rule.id !== rest[0]);
    await writeConfig(current);
    return;
  }
  if (subcommand === "clear") {
    await writeConfig({ ...current, guardrails: [] });
    return;
  }
  throw new Error("Usage: jevexec rules <list|add <rule>|remove <id>|clear>");
}

async function hooks(args) {
  const installScript = resolve(dirname(fileURLToPath(import.meta.url)), "..", "install.sh");
  const [subcommand, host] = args;
  let target;
  if (subcommand === "install" && args.length <= 2 && [undefined, "both", "codex", "claude"].includes(host)) {
    target = host ?? "both";
  } else if (subcommand === "uninstall" && args.length === 1) {
    target = "uninstall";
  } else {
    throw new Error("Usage: jevexec hooks <install [codex|claude|both]|uninstall>");
  }

  const result = spawnSync("bash", [installScript, target], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

function status() {
  const provider = new JevProvider({ settings: config.jev });
  console.log(JSON.stringify({ config: configPath(), activeGuardrails: config.guardrails.length, provider: provider.provider, apiKeyEnv: provider.apiKeyEnv, apiKeyConfigured: Boolean(provider.apiKey), model: provider.model, codex: "pre-tool rules can deny; permission requests are assessed for risk and may be auto-approved when low risk", claude: "pre-tool rules can deny or ask; permission requests are assessed for risk and may be auto-approved when low risk" }, null, 2));
}

async function audit(action, result, { trace = [], hookEventName, responseToHook = null } = {}) {
  const path = join(dirname(configPath()), "audit.jsonl");
  const entry = JSON.stringify(redact({
    id: randomUUID(),
    at: new Date().toISOString(),
    request: {
      host: action.host,
      hookEventName,
      tool: action.tool,
      parameters: action.input,
      cwd: action.cwd,
      userIntent: typeof action.userIntent === "string" ? action.userIntent.slice(0, 1000) : undefined,
      guardrails: action.guardrails
    },
    trace,
    assessment: result,
    responseToHook
  }));
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${entry}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
  const maxBytes = Number(process.env.JEVEXEC_AUDIT_MAX_BYTES || 1_000_000);
  const info = await stat(path);
  if (info.size > maxBytes) {
    const lines = (await readFile(path, "utf8")).trimEnd().split("\n").slice(-500);
    await writeFile(path, `${lines.join("\n")}\n`, { mode: 0o600 });
    await chmod(path, 0o600);
  }
}

function usage() {
  console.log("jevexec hook <codex|claude> | check <command> | hooks <install [codex|claude|both]|uninstall> | rules <list|add|remove|clear> | monitor | status");
}
