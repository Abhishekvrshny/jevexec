import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

test("installer registers both events once and preserves unrelated hooks", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "jevexec-install-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codexPath = join(home, ".codex", "hooks.json");
  const claudePath = join(home, ".claude", "settings.json");
  await mkdir(join(home, ".codex"), { recursive: true });
  await mkdir(join(home, ".claude"), { recursive: true });
  const retainedHook = { type: "command", command: "echo keep me" };
  await writeFile(codexPath, JSON.stringify({ hooks: {
    PreToolUse: [{ matcher: "Bash", hooks: [retainedHook] }],
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo prompt" }] }]
  }, customSetting: true }));
  await writeFile(claudePath, JSON.stringify({ hooks: {
    UserPromptSubmit: [{ hooks: [{ type: "command", command: "echo prompt" }] }]
  }, customSetting: true }));

  const runInstaller = (target) => spawnSync("bash", [join(repoRoot, "install.sh"), target], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      JEVEXEC_SOURCE_DIR: repoRoot,
      JEVEXEC_INSTALL_DIR: join(home, ".local", "share", "jevexec"),
      JEVEXEC_BIN_DIR: join(home, ".local", "bin"),
      OPENROUTER_API_KEY: "unit-test-key"
    }
  });
  const readSettings = async (path) => JSON.parse(await readFile(path, "utf8"));
  const countJevexec = (events, host, eventName) => events[eventName]
    .flatMap((group) => group.hooks)
    .filter((hook) => hook.command?.includes(`hook ${host}`)).length;

  for (const target of ["both", "both"]) {
    const result = runInstaller(target);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  const codex = await readSettings(codexPath);
  const claude = await readSettings(claudePath);
  for (const eventName of ["PreToolUse", "PermissionRequest"]) {
    assert.equal(countJevexec(codex.hooks, "codex", eventName), 1);
    assert.equal(countJevexec(claude.hooks, "claude", eventName), 1);
  }
  assert.equal(codex.hooks.PreToolUse.some((group) => group.hooks.some((hook) => hook.command === retainedHook.command)), true);
  assert.equal(codex.customSetting, true);
  assert.equal(claude.customSetting, true);

  const uninstall = runInstaller("uninstall");
  assert.equal(uninstall.status, 0, uninstall.stderr || uninstall.stdout);
  const codexAfter = await readSettings(codexPath);
  const claudeAfter = await readSettings(claudePath);
  assert.equal(codexAfter.hooks.PreToolUse.some((group) => group.hooks.some((hook) => hook.command === retainedHook.command)), true);
  assert.deepEqual(Object.keys(codexAfter.hooks), ["PreToolUse", "UserPromptSubmit"]);
  assert.deepEqual(Object.keys(claudeAfter.hooks), ["UserPromptSubmit"]);
});
