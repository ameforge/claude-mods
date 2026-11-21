import {expect, test} from "claude-code/testing";
import {allowRules, isAllowed} from "../hooks/allowed";

const ROOT = "D:/ws/app";
const LOCAL = JSON.stringify({
  permissions: {allow: ["Bash(git add:*)", "Bash(git commit:*)", "Read"]},
});

test("allowed matches every part of a command against the allow rules", () => {
  const rules = allowRules([LOCAL, "not json", "{}"], "Bash");
  expect(isAllowed("git add -A", rules)).toBe(true);
  expect(isAllowed('git add -A && git commit -m "a; b && c"', rules)).toBe(
    true,
  );
  expect(isAllowed("git add -A && git push", rules)).toBe(false);
  expect(isAllowed("git addx", rules)).toBe(false);
  expect(isAllowed("git add -A", allowRules([LOCAL], "PowerShell"))).toBe(
    false,
  );
  const glob = allowRules(
    [JSON.stringify({permissions: {allow: ["Bash(git * --dry-run)"]}})],
    "Bash",
  );
  expect(isAllowed("git clean -fd --dry-run", glob)).toBe(true);
  expect(isAllowed("git clean -fd", glob)).toBe(false);
  const all = allowRules(
    [JSON.stringify({permissions: {allow: ["Bash"]}})],
    "Bash",
  );
  expect(isAllowed("git reset --hard", all)).toBe(true);
});

// old.ts was dirty at start, so git add -A would sweep it in: stage-guard asks,
// unless the repo's settings allow git add.
test("stage-guard skips its ask when the repo allows the command", async ($, on) => {
  const asked: string[] = [];
  let settings = "{}";
  on("tool.call", (_$, e) => {
    if (e.tool === "AskUserQuestion") asked.push("ask");
    return {result: "ok"} as never;
  });
  on("session.start", (_$, e) => ({cwd: e.cwd}) as never);
  on("session.cwd", () => ({value: ROOT}) as never);
  on("fs.read", (_$, e) => {
    if (!e.path.endsWith("settings.local.json")) throw new Error(e.path);
    return {value: settings} as never;
  });
  on("process.run", (_$, e) => {
    const top = e.argv.includes("rev-parse");
    const stdout = top ? `${ROOT}\n` : " M old.ts\n";
    return {value: {exitCode: 0, stderr: "", stdout}} as never;
  });
  await $.session.start({cwd: ROOT, isInteractive: true, surface: null});
  await $.tool.call({command: "git add -A", tool: "Bash"});
  expect(asked.length).toBe(1);
  settings = LOCAL;
  const swept = await $.tool.call({command: "git add -A", tool: "Bash"});
  expect(swept.deny).toBeUndefined();
  expect(asked.length).toBe(1);
});
