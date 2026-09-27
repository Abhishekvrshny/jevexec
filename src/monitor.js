import React from "react";
import { render } from "ink";
import { dirname, join } from "node:path";
import { configPath } from "./config.js";
import { MonitorApp } from "./monitor-ui.js";

const h = React.createElement;

export async function monitor(args = []) {
  if (args.length) throw new Error("Usage: jevexec monitor");
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("jevexec monitor requires an interactive terminal.");
  }
  const auditPath = join(dirname(configPath()), "audit.jsonl");
  const app = render(h(MonitorApp, { auditPath }), { exitOnCtrlC: true });
  await app.waitUntilExit();
}
