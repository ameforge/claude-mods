import type {On} from "claude-code";
import {expect, mock, type TestBody, test} from "claude-code/testing";

// How the person typing a slash command reaches command.run.
const typed = {
  origin: {kind: "composer" as const},
  presentation: {columns: 120, isFullscreen: false},
};

type EngineOptions = {
  title?: string;
  // Ticket keys in the conversation's own rows, in order.
  transcriptKeys?: string[];
  // Ticket keys only in injected rows, such as a CLAUDE.md attachment.
  instructionKeys?: string[];
  // The git branch every conversation row records as metadata.
  gitBranch?: string;
  // A command name another plugin already owns.
  takenName?: string;
  env?: Record<string, string>;
  // The only path rg finds the transcript at, when set.
  transcriptAt?: string;
};

// The engine beneath the mod: one session titled `title` whose transcript
// holds the given keys; the slash commands it runs are collected.
const engine = (on: On, options: EngineOptions = {}) => {
  const commands: string[] = [];
  const toasts: string[] = [];
  // /rename with no name stands in for the name Claude Code would pick.
  let currentTitle = options.title ?? "My work";
  on("session.start", (_$, e) => ({cwd: e.cwd}));
  on("command.run", (_$, e) => {
    commands.push([e.command, e.args].filter(Boolean).join(" "));
    if (e.command === "rename" && !e.args) currentTitle = "Picked name";
    return {text: ""};
  });
  on("command.register", (_$, e) => {
    if (e.name === options.takenName) throw new Error(`"/${e.name}" refused`);
    return {value: {command: e.name}};
  });
  on("session.id", () => ({value: "session-1"}));
  on("session.cwd", () => ({value: "D:/ws/demo/.wt/ABC-1"}));
  on("session.root", () => ({value: "D:/ws/demo"}));
  on("env.get", (_$, e) => ({value: options.env?.[e.name]}));
  on("process.run", (_$, e) => {
    if (
      options.transcriptAt !== undefined &&
      e.argv[e.argv.length - 1] !== options.transcriptAt
    ) {
      return {
        value: {
          exitCode: 2,
          isStderrTruncated: false,
          isStdoutTruncated: false,
          stderr: "no such file",
          stdout: "",
        },
      };
    }
    const transcript = [
      ...(options.transcriptKeys ?? []).map((key) =>
        JSON.stringify({
          gitBranch: options.gitBranch,
          message: {content: key},
          type: "user",
        }),
      ),
      ...(options.instructionKeys ?? []).map((key) =>
        JSON.stringify({content: key, type: "attachment"}),
      ),
      JSON.stringify({customTitle: currentTitle, type: "custom-title"}),
    ];
    // rg as the mod runs it: the rows matching `-e`.
    const pattern = new RegExp(String(e.argv[e.argv.indexOf("-e") + 1]));
    return {
      value: {
        exitCode: 0,
        isStderrTruncated: false,
        isStdoutTruncated: false,
        stderr: "",
        stdout: transcript.filter((row) => pattern.test(row)).join("\n"),
      },
    };
  });
  on("ui.toast", (_$, e) => {
    toasts.push(e.text);
    return {value: undefined};
  });
  on("ui.log", () => ({value: undefined}));
  return {commands, toasts};
};

const runCommand = async (
  $: Parameters<TestBody>[0],
  clock: ReturnType<typeof mock.clock>,
  args = "",
) => {
  await $.session.start({
    cwd: "D:/ws/demo",
    isInteractive: true,
    surface: null,
  });
  await $.command.run({args, command: "rename-jira-stamp", ...typed});
  await clock.advance(1);
};

for (const [title, args, expected] of [
  ["app-ticket-abc-101", "", /^rename ABC-101_\d{8}_\d{6}$/],
  ["ABC-101_20261015_150400", "", /^rename ABC-101_\d{8}_\d{6}$/],
  ["ABC-303_2026-10-15 13:04", "", /^rename ABC-303_\d{8}_\d{6}$/],
  ["My work", "ABC-101 spec", /^rename ABC-101_\d{8}_\d{6}$/],
  ["My work", "", /^rename My work_\d{8}_\d{6}$/],
  ["", "", /^rename Picked name_\d{8}_\d{6}$/],
] as const) {
  test(`/rename-jira-stamp ${args} on "${title}" stamps the name`, async ($, on) => {
    const clock = mock.clock(on);
    const {commands} = engine(on, {title});
    await runCommand($, clock, args);
    expect(commands[commands.length - 1]).toMatch(expected);
  });
}

test("names the ticket the conversation mentions most, without asking Claude Code for a name", async ($, on) => {
  const clock = mock.clock(on);
  const {commands} = engine(on, {
    title: "",
    transcriptKeys: [
      "ABC-404",
      "ABC-202",
      "UTF-8",
      "UTF-8",
      "UTF-8",
      "ABC-202",
    ],
  });
  await runCommand($, clock);
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatch(/^rename ABC-202_\d{8}_\d{6}$/);
});

test("ignores a ticket key that only the injected instructions name", async ($, on) => {
  const clock = mock.clock(on);
  const {commands} = engine(on, {
    instructionKeys: ["ABC-505", "ABC-505", "ABC-505"],
    title: "My work",
  });
  await runCommand($, clock);
  expect(commands[commands.length - 1]).toMatch(/^rename My work_\d{8}_\d{6}$/);
});

test("ignores the ticket in the git branch every row records", async ($, on) => {
  const clock = mock.clock(on);
  const {commands} = engine(on, {
    gitBranch: "fix/ABC-606",
    title: "",
    transcriptKeys: ["ABC-707", "ABC-707"],
  });
  await runCommand($, clock);
  expect(commands[0]).toMatch(/^rename ABC-707_\d{8}_\d{6}$/);
});

test("a taken command name is a toast, not a failed session start", async ($, on) => {
  mock.clock(on);
  const {toasts} = engine(on, {takenName: "rename-jira-stamp"});
  await $.session.start({
    cwd: "D:/ws/demo",
    isInteractive: true,
    surface: null,
  });
  expect(toasts[0]).toContain("could not register");
});

test("reads the transcript under CLAUDE_CONFIG_DIR", async ($, on) => {
  const clock = mock.clock(on);
  const {commands} = engine(on, {
    env: {CLAUDE_CONFIG_DIR: "C:/cfg", USERPROFILE: "C:/Users/me"},
    title: "",
    transcriptAt: "C:/cfg/projects/D--ws-demo/session-1.jsonl",
    transcriptKeys: ["ABC-808"],
  });
  await runCommand($, clock);
  expect(commands[0]).toMatch(/^rename ABC-808_\d{8}_\d{6}$/);
});
