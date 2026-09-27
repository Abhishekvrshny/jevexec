import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { eventDetailLines, summarizeEvents, watchAuditFile } from "./monitor-data.js";

const h = React.createElement;
const DECISION_COLORS = { allow: "green", ask: "yellow", deny: "red", unavailable: "magenta" };

export function MonitorApp({ auditPath }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [snapshot, setSnapshot] = useState({ events: [], malformedLines: 0, pendingLine: false });
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [followLatest, setFollowLatest] = useState(true);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOffset, setDetailOffset] = useState(0);
  const eventsNewestFirst = useMemo(() => [...snapshot.events].reverse(), [snapshot.events]);
  const selectedIndex = followLatest ? 0 : Math.max(0, eventsNewestFirst.findIndex((event, index) => eventKey(event, index) === selectedEventId));
  const selected = eventsNewestFirst[selectedIndex];
  const summary = useMemo(() => summarizeEvents(snapshot.events), [snapshot.events]);
  const terminalRows = stdout?.rows ?? 24;

  useEffect(() => watchAuditFile(auditPath, setSnapshot), [auditPath]);
  useEffect(() => {
    if (!followLatest && selectedEventId && !eventsNewestFirst.some((event, index) => eventKey(event, index) === selectedEventId)) {
      setFollowLatest(true);
    }
  }, [eventsNewestFirst, followLatest, selectedEventId]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      exit();
      return;
    }
    if (detailOpen) {
      if (key.escape || input === "h") {
        setDetailOpen(false);
        return;
      }
      const maxOffset = Math.max(0, selectedLines.length - Math.max(5, terminalRows - 6));
      if (key.upArrow || input === "k") setDetailOffset((offset) => Math.max(0, offset - 1));
      if (key.downArrow || input === "j") setDetailOffset((offset) => Math.min(maxOffset, offset + 1));
      if (key.pageUp) setDetailOffset((offset) => Math.max(0, offset - Math.max(5, terminalRows - 7)));
      if (key.pageDown) setDetailOffset((offset) => Math.min(maxOffset, offset + Math.max(5, terminalRows - 7)));
      return;
    }
    if (key.upArrow || input === "k") selectEvent(Math.max(0, selectedIndex - 1));
    if (key.downArrow || input === "j") selectEvent(Math.min(eventsNewestFirst.length - 1, selectedIndex + 1));
    if (key.return && selected) {
      setDetailOffset(0);
      setDetailOpen(true);
    }
  });

  const rowsToShow = Math.max(3, Math.min(16, terminalRows - 7));
  const listStart = Math.max(0, Math.min(selectedIndex, eventsNewestFirst.length - rowsToShow));
  const selectedLines = selected ? eventDetailLines(selected) : [];
  const detailRows = Math.max(5, terminalRows - 6);
  const visibleDetails = selectedLines.slice(detailOffset, detailOffset + detailRows);

  function selectEvent(index) {
    if (index === 0) {
      setFollowLatest(true);
      return;
    }
    const event = eventsNewestFirst[index];
    if (!event) return;
    setSelectedEventId(eventKey(event, index));
    setFollowLatest(false);
  }

  return h(Box, { flexDirection: "column", paddingX: 1 },
    h(Box, { justifyContent: "space-between" },
      h(Text, { bold: true, color: "cyan" }, "jevexec monitor"),
      h(Text, { dimColor: true }, "live · completed audit events")
    ),
    h(Text, { dimColor: true }, auditPath),
    h(Box, { marginTop: 1, flexDirection: "column", borderStyle: "round", borderColor: "blue", paddingX: 1 },
      h(Text, { bold: true }, `Events ${summary.total}   Jev evaluated ${summary.jevEvaluations}   No Jev call ${summary.total - summary.jevEvaluations}`),
      h(Text, null,
        h(Text, { color: "green" }, `ALLOW ${summary.decisions.allow}  `),
        h(Text, { color: "yellow" }, `ASK ${summary.decisions.ask}  `),
        h(Text, { color: "red" }, `DENY ${summary.decisions.deny}  `),
        h(Text, { color: "magenta" }, `UNAVAILABLE ${summary.decisions.unavailable}`)
      ),
      h(Text, { dimColor: true }, `Hook levels: pre-tool ${summary.hooks.PreToolUse} · permission ${summary.hooks.PermissionRequest} · CLI ${summary.hooks.CLI}`)
    ),
    h(Box, { marginTop: 1, flexDirection: "column" },
      h(Text, { bold: true, color: "cyan" }, detailOpen ? "Selected event details" : "Recent events (newest first)"),
      detailOpen
        ? (selected
          ? h(Box, { flexDirection: "column", borderStyle: "single", borderColor: "gray", paddingX: 1 },
            ...visibleDetails.map((line, index) => h(Text, { key: `${detailOffset + index}`, color: line === "ASSESSMENT TRACE" ? "cyan" : undefined }, line)))
          : h(Text, { dimColor: true }, "No audit events yet."))
        : h(Box, { flexDirection: "column" },
          h(Text, { dimColor: true }, "  TIME     HOST   HOOK         TOOL           DECISION  JEV"),
          ...eventsNewestFirst.slice(listStart, listStart + rowsToShow).map((event, visibleIndex) => {
            const index = listStart + visibleIndex;
            return eventRow(event, index === selectedIndex, index);
          })
        )
    ),
    snapshot.error ? h(Text, { color: "red" }, `Audit read error: ${snapshot.error.message}`) : null,
    snapshot.malformedLines ? h(Text, { color: "yellow" }, `Skipped ${snapshot.malformedLines} malformed audit line(s).`) : null,
    snapshot.pendingLine ? h(Text, { dimColor: true }, "Waiting for the current audit record to finish writing…") : null,
    h(Box, { marginTop: 1, justifyContent: "space-between" },
      h(Text, { dimColor: true }, detailOpen ? "↑/↓ or j/k scroll · PgUp/PgDn page · Esc return" : "↑/↓ or j/k select · Enter details"),
      h(Text, { dimColor: true }, "q quit")
    )
  );
}

function eventRow(event, selected, index) {
  const request = event.request ?? {};
  const hook = hookLabel(request.hookEventName ?? (request.host === "cli" ? "check" : "unknown"));
  const hasJev = event.trace?.some((item) => item?.step === "jev_request");
  const decision = event.assessment?.decision ?? "unknown";
  const time = event.at ? new Date(event.at).toLocaleTimeString() : "--:--:--";
  return h(Text, { key: event.id ?? `${event.at}-${index}`, color: selected ? "cyan" : undefined, bold: selected },
    `${selected ? "▶" : " "} ${time} ${clip(request.host ?? "?", 6).padEnd(6)} ${clip(hook, 12).padEnd(12)} ${clip(request.tool ?? "?", 14).padEnd(14)} `,
    h(Text, { color: DECISION_COLORS[decision] ?? "gray" }, clip(decision.toUpperCase(), 9).padEnd(9)),
    ` ${hasJev ? "yes" : "no"}`
  );
}

function hookLabel(hook) {
  if (hook === "PreToolUse") return "pre-tool";
  if (hook === "PermissionRequest") return "permission";
  if (hook === "check") return "check";
  return String(hook);
}

function eventKey(event, index) {
  return event.id ?? `${event.at ?? "unknown"}:${event.request?.hookEventName ?? ""}:${event.request?.tool ?? ""}:${index}`;
}

function clip(value, maxLength) {
  const text = String(value);
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
