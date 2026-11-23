import type {On} from "claude-code";
import {expect, test} from "claude-code/testing";

const BULLET = "•";

const engine = (on: On) => {
  const ran: string[] = [];
  on("tool.call", (_$, e) => {
    ran.push(e.tool);
    return {result: "ok"};
  });
  return ran;
};

test("no-bullet denies a Write or Edit that adds the bullet, in any file", async ($, on) => {
  const ran = engine(on);
  const write = await $.tool.call({
    content: `const label = "${BULLET} 5";`,
    file_path: "hub/hub.js",
    tool: "Write",
  });
  expect(write.deny).toContain(`No ${BULLET} character`);
  const edit = await $.tool.call({
    file_path: "README.md",
    new_string: `${BULLET} one`,
    old_string: "- one",
    tool: "Edit",
  });
  expect(edit.deny).toContain(`No ${BULLET} character`);
  expect(ran).toEqual([]);
});

test("no-bullet lets text without the bullet through", async ($, on) => {
  const ran = engine(on);
  await $.tool.call({
    content: "- a list item\n✓ chosen",
    file_path: "a.md",
    tool: "Write",
  });
  expect(ran).toEqual(["Write"]);
});
