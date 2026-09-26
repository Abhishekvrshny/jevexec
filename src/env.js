import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const SECRET_NAMES = new Set(["OPENROUTER_API_KEY", "TYPESAFE_API_KEY", "JEV_API_KEY"]);

export async function loadHookEnvironment(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const path = join(configHome, "jevexec", "env");
  let contents;
  try {
    const info = await stat(path);
    if (!info.isFile()) return;
    if ((info.mode & 0o077) !== 0) {
      console.error(`jevexec: ignoring ${path}; permissions must be 600 or stricter (run chmod 600 ${path}).`);
      return;
    }
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") console.error(`jevexec: could not read ${path}; relying on the process environment.`);
    return;
  }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || !SECRET_NAMES.has(match[1]) || env[match[1]]) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
}
