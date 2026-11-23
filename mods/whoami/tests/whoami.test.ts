import type {On} from "claude-code";
import {expect, type TestBody, test} from "claude-code/testing";

// The engine beneath the mod: ListAgents answers with `text`.
const engine = (on: On, text: string) => {
  on("session.start", (_$, e) => ({cwd: e.cwd}));
  on("command.register", () => ({value: {command: "whoami"}}));
  on("tool.call", {tool: "ListAgents"}, () => ({result: {sections: []}, text}));
};

const typed = {
  origin: {kind: "composer" as const},
  presentation: {columns: 120, isFullscreen: false},
};

const listed = (name: string) =>
  `This session is ${name} [40c18f] — the name other sessions use to message it.`;

const whoami = async ($: Parameters<TestBody>[0]) => {
  await $.session.start({
    cwd: "D:/ws/demo",
    isInteractive: true,
    surface: null,
  });
  return $.command.run({args: "", command: "whoami", ...typed});
};

test("/whoami prints the session name from ListAgents", async ($, on) => {
  engine(on, listed("claude-mods-95"));
  expect((await whoami($)).text).toBe("claude-mods-95");
});

test("/whoami says so when ListAgents' text no longer matches", async ($, on) => {
  engine(on, "No other sessions are running.");
  expect((await whoami($)).text).toBe(
    "This session's name could not be read from ListAgents.",
  );
});
