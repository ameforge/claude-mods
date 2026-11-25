import {expect, test} from "claude-code/testing";
import {labOrigin, needsGitAsk} from "../hooks/git-ask";

const LAB = "D:/ws/lab";
const WORK = "D:/ws/work";
const ORIGINS: Record<string, string> = {
  [LAB]: "git@github.com:labowner/claude-mods.git\n",
  [WORK]: "https://github.com/acme/app.git\n",
};
const lab = labOrigin("other, LabOwner");

// `git -C <dir> remote get-url origin`, answered from ORIGINS (drive letter in
// any case, as on Windows); an unknown dir is no repo.
const run = (argv: readonly string[]) => {
  const dir = (argv[2] ?? "").replace(/^[a-z]:/, (d) => d.toUpperCase());
  const origin = ORIGINS[dir];
  return Promise.resolve({exitCode: origin ? 0 : 128, stdout: origin ?? ""});
};

const ask = (command: string, cwd: string) =>
  needsGitAsk(command, cwd, run, lab);

// The test engine never turns a PreToolUse ask into a dialog, so the decision is tested here.
test("git-ask asks outside a lab repo", async () => {
  expect(await ask("git commit -m x", WORK)).toBe(true);
  expect(await ask("gh pr create --fill", WORK)).toBe(true);
  expect(await ask("git -c user.name=x commit -m y", WORK)).toBe(true);
});

test("git-ask asks when a lab command moves to another repo", async () => {
  for (const command of [
    `cd ${WORK} && git push`,
    `git -C ${WORK} commit -m x`,
    "cd $HOME/app && git push",
    "cd ~/app && git push",
    `(cd ${WORK} && git push)`,
    `git -c core.x=y -C ${WORK} commit -m x`,
  ]) {
    expect(await ask(command, LAB)).toBe(true);
  }
});

test("git-ask stays quiet in a lab repo and on other commands", async () => {
  expect(await ask("git commit -m x && git push", LAB)).toBe(false);
  expect(await ask(`cd ${LAB} && git push`, LAB)).toBe(false);
  expect(await ask("cd /d/ws/lab && git push", LAB)).toBe(false);
  expect(await ask("git status && git log", WORK)).toBe(false);
});

// Outside a lab repo the hook asks in its own dialog; only "Run" lets the call on.
test("git-ask runs a push outside a lab repo only when the person says Run", async ($, on) => {
  const answers = ["Run", "Cancel"];
  const asked: string[] = [];
  const ran: string[] = [];
  on("tool.call", (_$, e) => {
    if (e.tool === "Bash") ran.push(e.command);
    if (e.tool !== "AskUserQuestion") return {result: "ok"} as never;
    const question = e.questions[0]?.question ?? "";
    asked.push(question);
    const answer = {[question]: answers.shift() ?? ""};
    return {result: {answers: answer, questions: e.questions}} as never;
  });
  on("session.cwd", () => ({value: WORK}) as never);
  on(
    "process.run",
    () => ({value: {exitCode: 128, stderr: "", stdout: ""}}) as never,
  );
  await $.tool.call({command: "git push", tool: "Bash"});
  const declined = await $.tool.call({command: "git push", tool: "Bash"});
  await $.tool.call({command: "git status", tool: "Bash"});
  expect(asked.length).toBe(2);
  expect(asked[0]).toContain("Run it?");
  expect(ran).toEqual(["git push", "git status"]);
  expect(declined.deny).toContain("Declined");
});

test("git-ask asks everywhere when no lab owner is set", async () => {
  expect(labOrigin(" , ")).toBeNull();
  expect(await needsGitAsk("git push", LAB, run, labOrigin(""))).toBe(true);
});
