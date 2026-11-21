import type {On} from "claude-code";
import {expect, test} from "claude-code/testing";

// The engine beneath the mod runs every shell command it is handed.
const engine = (on: On) => {
  const ran: string[] = [];
  on("tool.call", (_$, e) => {
    if (e.tool === "Bash" || e.tool === "PowerShell") ran.push(e.command);
    return {result: "ok"};
  });
  return ran;
};

const TRAILER = ["Co-Authored", "By: Bot <bot@example.com>"].join("-");

test("no-credit blocks attribution in a commit or PR", async ($, on) => {
  const ran = engine(on);
  for (const command of [
    `git commit -m "fix: x\n\n${TRAILER}"`,
    'git commit -m "fix: x" -m "Generated with [Claude Code](https://claude.com)"',
    `gh pr create --title x --body "done \u{1F916}"`,
  ]) {
    const result = await $.tool.call({command, tool: "Bash"});
    expect(result.deny).toContain("no attribution");
  }
  const ps = await $.tool.call({
    command: `git commit -m "x\n\n${TRAILER}"`,
    tool: "PowerShell",
  });
  expect(ps.deny).toContain("no attribution");
  expect(ran).toEqual([]);
});

test("no-credit lets plain commits and other commands through", async ($, on) => {
  const ran = engine(on);
  const commands = [
    'git commit -m "fix: name the ticket from the conversation"',
    `echo "${TRAILER}" >> notes.txt`,
  ];
  for (const command of commands) {
    await $.tool.call({command, tool: "Bash"});
  }
  expect(ran).toEqual(commands);
});
