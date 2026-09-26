import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function configPath(env = process.env) {
  return env.JEVEXEC_CONFIG || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "jevexec", "config.json");
}

export async function readConfig(env = process.env) {
  try {
    const value = JSON.parse(await readFile(configPath(env), "utf8"));
    return { guardrails: Array.isArray(value.guardrails) ? value.guardrails.filter((rule) => rule && typeof rule.id === "string" && typeof rule.text === "string" && rule.enabled !== false) : [] };
  } catch {
    return { guardrails: [] };
  }
}

export async function writeConfig(config, env = process.env) {
  const path = configPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
