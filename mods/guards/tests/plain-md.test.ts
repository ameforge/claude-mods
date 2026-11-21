import type {On} from "claude-code";
import {expect, test} from "claude-code/testing";

// The engine beneath the mod runs every file write it is handed.
const engine = (on: On) => {
  const ran: string[] = [];
  on("tool.call", (_$, e) => {
    ran.push(e.tool);
    return {result: "ok"};
  });
  return ran;
};

test("plain-md blocks bold and italic in a markdown file", async ($, on) => {
  const ran = engine(on);
  for (const content of [
    "Run **this** first.",
    "Run __this__ first.",
    "Run *this* first.",
    "Run _this_ first.",
  ]) {
    const result = await $.tool.call({
      content,
      file_path: "docs/a.md",
      tool: "Write",
    });
    expect(result.deny).toContain("no bold or italic");
  }
  const edit = await $.tool.call({
    file_path: "README.md",
    new_string: "a *b* c",
    old_string: "a b c",
    tool: "Edit",
  });
  expect(edit.deny).toContain("no bold or italic");
  expect(ran).toEqual([]);
});

test("plain-md lets plain markdown, code and other files through", async ($, on) => {
  const ran = engine(on);
  for (const content of [
    "* a bullet\n- another\n\n2 * 3 * 4",
    "Use `**kwargs` and snake_case_names, or src/*.ts globs.",
    "```py\ndef f(**kwargs): return _x_\n```",
  ]) {
    await $.tool.call({content, file_path: "docs/a.md", tool: "Write"});
  }
  await $.tool.call({
    content: "const x = a ** b; // *y*",
    file_path: "a.ts",
    tool: "Write",
  });
  expect(ran).toEqual(["Write", "Write", "Write", "Write"]);
});
