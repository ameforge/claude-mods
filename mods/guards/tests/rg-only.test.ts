import type {On} from "claude-code";
import {expect, test} from "claude-code/testing";

// The engine beneath the mod runs every Bash call it is handed.
const engine = (on: On) => {
  const ran: string[] = [];
  on("tool.call", {tool: "Bash"}, (_$, e) => {
    ran.push(e.command);
    return {result: "ok"};
  });
  return ran;
};

test("rg-only blocks recursive grep", async ($, on) => {
  const ran = engine(on);
  for (const command of [
    "grep -rn foo .",
    "grep --recursive foo src",
    "cd src && egrep -Ri foo .",
    "echo $(grep -r foo .)",
  ]) {
    const result = await $.tool.call({command, tool: "Bash"});
    expect(result.deny).toContain("rg -n");
  }
  expect(ran).toEqual([]);
});

test("rg-only lets other commands through", async ($, on) => {
  const ran = engine(on);
  const commands = [
    "grep foo file.txt",
    "cat log | grep -i error",
    "grep -n foo -- -r",
    "grep -rn foo . # allow-grep-r",
    "rg -n foo",
  ];
  for (const command of commands) {
    await $.tool.call({command, tool: "Bash"});
  }
  expect(ran).toEqual(commands);
});
