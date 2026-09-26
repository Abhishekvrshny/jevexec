import { spawn } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const installDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cacheDir = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
const stateDir = join(cacheDir, "jevexec");
const checkFile = join(stateDir, "update-check");
const lockDir = join(stateDir, "update-lock");
const intervalMs = 24 * 60 * 60 * 1000;
const staleLockMs = 60 * 60 * 1000;

export async function startUpdateCheck() {
  if (process.env.JEVEXEC_AUTO_UPDATE === "0") return;

  try {
    const lastCheck = Number(await readFile(checkFile, "utf8"));
    if (Number.isFinite(lastCheck) && Date.now() - lastCheck < intervalMs) return;
  } catch {
    // No previous check; start one in the background.
  }

  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await mkdir(lockDir);
  } catch {
    try {
      const lock = await stat(lockDir);
      if (Date.now() - lock.mtimeMs < staleLockMs) return;
      await rm(lockDir, { recursive: true, force: true });
      await mkdir(lockDir);
    } catch {
      return;
    }
  }

  try {
    const worker = spawn(process.execPath, [fileURLToPath(import.meta.url), "--run"], {
      detached: true,
      stdio: "ignore",
      env: process.env
    });
    worker.on("error", () => { void rm(lockDir, { recursive: true, force: true }); });
    worker.unref();
  } catch {
    await rm(lockDir, { recursive: true, force: true });
  }
}

async function updateCheckout() {
  try {
    const branch = await git(["branch", "--show-current"]);
    const remote = await git(["remote", "get-url", "origin"]);
    const clean = await git(["status", "--porcelain"]);
    if (branch !== "main" || clean || !isOfficialRemote(remote)) return;

    const shallowPath = (await git(["rev-parse", "--git-path", "shallow"])).trim();
    try {
      await stat(resolve(installDir, shallowPath));
      await git(["fetch", "--quiet", "--unshallow", "origin", "main"]);
    } catch (error) {
      if (error?.code === "ENOENT") await git(["fetch", "--quiet", "origin", "main"]);
      else throw error;
    }
    await git(["merge", "--ff-only", "--quiet", "FETCH_HEAD"]);
  } finally {
    await writeFile(checkFile, String(Date.now()), { mode: 0o600 }).catch(() => {});
    await rm(lockDir, { recursive: true, force: true }).catch(() => {});
  }
}

function isOfficialRemote(remote) {
  return remote === "https://github.com/Abhishekvrshny/jevexec.git" ||
    remote === "git@github.com:Abhishekvrshny/jevexec.git";
}

function git(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: installDir, stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`git ${args[0]} failed (${code})`));
    });
  });
}

if (process.argv[2] === "--run") {
  await updateCheckout().catch(() => {
    void writeFile(checkFile, String(Date.now()), { mode: 0o600 }).catch(() => {});
    void rm(lockDir, { recursive: true, force: true }).catch(() => {});
  });
}
