import {expect, test} from "claude-code/testing";
import {destructiveSteps, previewFiles} from "../hooks/git-preview";

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

test("git-preview follows git -C to the repo it names", () => {
  expect(destructiveSteps("git -C ../other reset --hard")[0]?.dir).toBe(
    "../other",
  );
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
