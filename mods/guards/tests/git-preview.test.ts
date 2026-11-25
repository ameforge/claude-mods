import {expect, test} from "claude-code/testing";
import {
  destructiveSteps,
  previewFiles,
  previewQuestion,
  resolveDir,
} from "../hooks/git-preview";

const CWD = "D:/ws/app";

// A repo with two edited files and one untracked; `git clean -n` lists the untracked one.
const run = (argv: readonly string[]) => {
  const sub = argv[5];
  const paths = argv.slice(argv.indexOf("--") + 1);
  if (sub === "clean")
    return Promise.resolve({exitCode: 0, stdout: "Would remove tmp.log\n"});
  const rows = [" M src/a.ts", " M src/b.ts"].filter(
    (r) => !paths.length || paths.some((p) => p === "." || r.endsWith(p)),
  );
  if (argv.includes("--untracked-files=all")) rows.push("?? tmp.log");
  return Promise.resolve({exitCode: 0, stdout: `${rows.join("\n")}\n`});
};

test("git-preview lists the files a destructive git command would touch", async () => {
  const files = (command: string) => previewFiles(command, CWD, run);
  expect(await files("git reset --hard")).toEqual(["src/a.ts", "src/b.ts"]);
  expect(await files("git checkout -- src/a.ts")).toEqual(["src/a.ts"]);
  expect(await files("git restore src/b.ts")).toEqual(["src/b.ts"]);
  expect(await files("git stash -u")).toContain("tmp.log");
  expect(await files("git status && git clean -fd")).toEqual(["tmp.log"]);
});

test("git-preview stays quiet on commands that keep the work tree", () => {
  for (const command of [
    "git status",
    "git reset HEAD~1",
    "git restore --staged src/a.ts",
    "git stash list",
    "git stash pop",
    "git checkout main",
    "git clean -n",
    "git commit -m 'git reset --hard'",
  ]) {
    expect(destructiveSteps(command)).toEqual([]);
  }
});

test("git-preview follows git -C and a cd before git to the repo they name", () => {
  const dir = (command: string) => destructiveSteps(command)[0]?.dir;
  expect(dir("git -C ../other reset --hard")).toBe("../other");
  expect(dir("cd D:/ws/other && git reset --hard")).toBe("D:/ws/other");
  expect(dir("cd D:/ws && cd other; git -C sub clean -fd")).toBe(
    "D:/ws/other/sub",
  );
  expect(resolveDir("/d/ws/other", CWD)).toBe("d:/ws/other");
  expect(resolveDir("sub", CWD)).toBe(`${CWD}/sub`);
});

test("git-preview lists the stashes a stash drop or clear would delete", async () => {
  const stashes = (argv: readonly string[]) =>
    Promise.resolve({
      exitCode: argv.includes("list") ? 0 : 1,
      stdout: "stash@{0}: WIP on main: abc\nstash@{1}: On main: old\n",
    });
  expect(await previewFiles("git stash drop", CWD, stashes)).toEqual([
    "stash@{0}: WIP on main: abc",
  ]);
  expect(await previewFiles("git stash drop stash@{1}", CWD, stashes)).toEqual([
    "stash@{1}: On main: old",
  ]);
  expect(await previewFiles("git stash clear", CWD, stashes)).toHaveLength(2);
});

// Only "Run" lets the command on, from Bash and PowerShell alike.
test("git-preview runs a reset only when the person says Run", async ($, on) => {
  const answers = ["Run", "Cancel"];
  const asked: string[] = [];
  const ran: string[] = [];
  on("tool.call", (_$, e) => {
    if (e.tool === "Bash" || e.tool === "PowerShell") ran.push(e.command);
    if (e.tool !== "AskUserQuestion") return {result: "ok"} as never;
    const question = e.questions[0]?.question ?? "";
    asked.push(question);
    const answer = {[question]: answers.shift() ?? ""};
    return {result: {answers: answer, questions: e.questions}} as never;
  });
  on("session.cwd", () => ({value: CWD}) as never);
  on(
    "process.run",
    () =>
      ({value: {exitCode: 0, stderr: "", stdout: " M src/a.ts\n"}}) as never,
  );
  await $.tool.call({command: "git reset --hard", tool: "Bash"});
  const declined = await $.tool.call({
    command: "git reset --hard",
    tool: "PowerShell",
  });
  expect(asked.length).toBe(2);
  expect(asked[0]).toContain("src/a.ts");
  expect(ran).toEqual(["git reset --hard"]);
  expect(declined.deny).toContain("Declined");
});

test("git-preview puts each file on its own line and counts the rest", () => {
  const files = Array.from({length: 12}, (_, i) => `src/f${i}.ts`);
  expect(previewQuestion(files)).toBe(
    [
      "This git command would discard 12 file(s) or stash(es):",
      ...files.slice(0, 10).map((f) => `  ${f}`),
      "  and 2 more",
      "",
      "Run it?",
    ].join("\n"),
  );
});
