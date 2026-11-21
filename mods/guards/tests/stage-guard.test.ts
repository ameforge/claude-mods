import {expect, test} from "claude-code/testing";
import {foreignFiles, sweepDir} from "../hooks/stage-guard";

const ROOT = "D:/ws/app";

test("stage-guard spots the commands that sweep the whole tree", () => {
  for (const command of [
    "git add -A",
    "git add .",
    "git add -u && git commit -m x",
    'git commit -am "fix a bug"',
    "git commit --all -m x",
  ]) {
    expect(sweepDir(command)).toBe("");
  }
  expect(sweepDir("git -C ../other add --all")).toBe("../other");
  for (const command of [
    "git add src/a.ts",
    'git commit -m "add -A later"',
    "git commit --amend --no-edit",
    "git status",
  ]) {
    expect(sweepDir(command)).toBeNull();
  }
});

test("stage-guard counts as foreign only files dirty at start and never written", () => {
  const baseline = new Set(["old.ts", "shared.ts"]);
  const written = new Set(["D:\\ws\\app\\shared.ts", "D:\\ws\\app\\new.ts"]);
  expect(
    foreignFiles(["old.ts", "shared.ts", "new.ts"], baseline, written, ROOT),
  ).toEqual(["old.ts"]);
});

// A fake repo: old.ts was dirty before the session; the session then edits new.ts.
test("stage-guard asks before git add -A sweeps in another session's file", async ($, on) => {
  const answers = ["Cancel"];
  const asked: string[] = [];
  const ran: string[] = [];
  let dirty = " M old.ts\n";
  on("tool.call", (_$, e) => {
    if (e.tool === "Bash") ran.push(e.command);
    if (e.tool !== "AskUserQuestion") return {result: "ok"} as never;
    const question = e.questions[0]?.question ?? "";
    asked.push(question);
    const answer = {[question]: answers.shift() ?? ""};
    return {result: {answers: answer, questions: e.questions}} as never;
  });
  on("session.start", (_$, e) => ({cwd: e.cwd}) as never);
  on("session.cwd", () => ({value: ROOT}) as never);
  on("process.run", (_$, e) => {
    const top = e.argv.includes("rev-parse");
    const stdout = top ? `${ROOT}\n` : dirty;
    return {value: {exitCode: 0, stderr: "", stdout}} as never;
  });
  await $.session.start({cwd: ROOT, isInteractive: true, surface: null});
  await $.tool.call({content: "x", file_path: `${ROOT}/new.ts`, tool: "Write"});
  dirty = " M old.ts\n?? new.ts\n";
  const declined = await $.tool.call({command: "git add -A", tool: "Bash"});
  await $.tool.call({command: "git add new.ts", tool: "Bash"});
  expect(asked.length).toBe(1);
  expect(asked[0]).toContain("old.ts");
  expect(declined.deny).toContain("git add new.ts");
  expect(ran).toEqual(["git add new.ts"]);
});

// No session.start for this repo: the sweep itself takes the baseline, so only
// the file the session wrote is let through without asking.
test("stage-guard asks in a repo first seen at the sweep", async ($, on) => {
  const asked: string[] = [];
  on("tool.call", (_$, e) => {
    if (e.tool !== "AskUserQuestion") return {result: "ok"} as never;
    const question = e.questions[0]?.question ?? "";
    asked.push(question);
    return {
      result: {answers: {[question]: "Cancel"}, questions: e.questions},
    } as never;
  });
  on("session.cwd", () => ({value: "D:/ws/home"}) as never);
  on("process.run", (_$, e) => {
    const stdout = e.argv.includes("rev-parse")
      ? `${ROOT}\n`
      : " M old.ts\n?? new.ts\n";
    return {value: {exitCode: 0, stderr: "", stdout}} as never;
  });
  await $.tool.call({content: "x", file_path: `${ROOT}/new.ts`, tool: "Write"});
  const declined = await $.tool.call({
    command: `git -C ${ROOT} add -A`,
    tool: "PowerShell",
  });
  expect(asked.length).toBe(1);
  expect(asked[0]).toContain("old.ts");
  expect(asked[0]).not.toContain("new.ts");
  expect(declined.deny).toContain("git add new.ts");
});
