import {expect, test} from "claude-code/testing";

const WORK = "D:/ws/work";
const ALL =
  "rg-only no-credit private-terms git-preview stage-guard git-ask plain-md no-bullet";

test(
  "every guard stands aside when the off setting names it",
  {options: {labOwners: "labowner", off: ALL, privateTerms: "ABC"}},
  async ($, on) => {
    const ran: string[] = [];
    on("tool.call", (_$, e) => {
      ran.push(e.tool);
      return {result: "ok"} as never;
    });
    on("session.cwd", () => ({value: WORK}) as never);
    on("process.run", (_$, e) => {
      const stdout = e.argv.includes("rev-parse") ? `${WORK}\n` : " M a.ts\n";
      return {value: {exitCode: 0, stderr: "", stdout}} as never;
    });
    const trailer = ["Co-Authored", "By: Bot <bot@example.com>"].join("-");
    for (const command of [
      "grep -r x .",
      `git commit -m "ABC-1\n\n${trailer}"`,
      "git reset --hard",
      "git add -A",
      "git push",
    ]) {
      const result = await $.tool.call({command, tool: "Bash"});
      expect(result.deny).toBeUndefined();
    }
    const bullet = String.fromCharCode(0x2022);
    const write = await $.tool.call({
      content: `**ABC** ${bullet} x`,
      file_path: `${WORK}/a.md`,
      tool: "Write",
    });
    expect(write.deny).toBeUndefined();
    expect(ran.filter((t) => t === "AskUserQuestion")).toEqual([]);
  },
);

test("a dialog that fails counts as Cancel", async ($, on) => {
  const ran: string[] = [];
  on("tool.call", (_$, e) => {
    if (e.tool === "AskUserQuestion") throw new Error("no dialog");
    ran.push(e.tool);
    return {result: "ok"} as never;
  });
  on("session.cwd", () => ({value: WORK}) as never);
  on(
    "process.run",
    () => ({value: {exitCode: 128, stderr: "", stdout: ""}}) as never,
  );
  const result = await $.tool.call({command: "git push", tool: "PowerShell"});
  expect(result.deny).toContain("Declined");
  expect(ran).toEqual([]);
});
