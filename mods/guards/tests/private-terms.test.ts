import type {On} from "claude-code";
import {expect, test} from "claude-code/testing";

const LAB = "D:/ws/lab";
const WORK = "D:/ws/work";
const ORIGINS: Record<string, string> = {
  [LAB]: "git@github.com:labowner/tools.git\n",
  [WORK]: "https://github.com/acme/app.git\n",
};
const options = {labOwners: "labowner", privateTerms: "ABC, acme-corp"};

type Repo = {grep?: string; log?: string};

// The engine beneath the mod: a session in cwd, `git remote get-url` answered
// from ORIGINS, `git grep` and `git log` from repo, and every tool call it is
// handed collected.
const engine = (on: On, cwd: string, repo: Repo = {}) => {
  const ran: string[] = [];
  on("tool.call", (_$, e) => {
    ran.push(e.tool);
    return {result: "ok"} as never;
  });
  on("session.cwd", () => ({value: cwd}) as never);
  on("process.run", (_$, e) => {
    const verb = e.argv[3];
    const origin = verb === "remote" ? ORIGINS[e.argv[2] ?? ""] : "";
    const stdout =
      verb === "grep" ? repo.grep : verb === "log" ? repo.log : origin;
    return {
      value: {
        exitCode: stdout ? 0 : verb === "remote" ? 128 : 1,
        isStderrTruncated: false,
        isStdoutTruncated: false,
        stderr: "",
        stdout: stdout ?? "",
      },
    } as never;
  });
  return ran;
};

test(
  "private-terms denies a Write, Edit or commit holding a term in a lab repo",
  {options},
  async ($, on) => {
    const ran = engine(on, LAB);
    const write = await $.tool.call({
      content: "Fixes abc-101.",
      file_path: `${LAB}/src/a.ts`,
      tool: "Write",
    });
    const edit = await $.tool.call({
      file_path: `${LAB}/README.md`,
      new_string: "Built for Acme-Corp.",
      old_string: "x",
      tool: "Edit",
    });
    const commit = await $.tool.call({
      command: 'git commit -m "fix: ABC-7 crash"',
      tool: "Bash",
    });
    for (const result of [write, edit, commit]) {
      expect(result.deny).toContain("private term");
    }
    expect(ran).toEqual([]);
  },
);

test(
  "private-terms lets a term through outside a lab repo, and matches whole words only",
  {options},
  async ($, on) => {
    const ran = engine(on, LAB);
    await $.tool.call({
      content: "Fixes ABC-101.",
      file_path: `${WORK}/a.ts`,
      tool: "Write",
    });
    await $.tool.call({
      content: "ABCD and xabc and acme are fine.",
      file_path: `${LAB}/a.ts`,
      tool: "Write",
    });
    expect(ran).toEqual(["Write", "Write"]);
  },
);

test("private-terms checks nothing when no term is set", async ($, on) => {
  const ran = engine(on, LAB);
  await $.tool.call({
    content: "Fixes ABC-101.",
    file_path: `${LAB}/a.ts`,
    tool: "Write",
  });
  expect(ran).toEqual(["Write"]);
});

test(
  "private-terms denies a commit when a file in the repo holds a term, however it was written",
  {options},
  async ($, on) => {
    const ran = engine(on, LAB, {
      grep: "notes/a.md:3:see ABC-12\nsrc/b.ts:9:const abcd = 1",
    });
    const result = await $.tool.call({
      command: "git add -A && git commit -m x",
      tool: "Bash",
    });
    expect(result.deny).toContain("Found in: notes/a.md.");
    expect(ran).toEqual([]);
  },
);

test(
  "private-terms denies a push whose unpushed commits hold a term",
  {options},
  async ($, on) => {
    const ran = engine(on, LAB, {
      log: "commit 1a2b3c\n+++ b/a.ts\n-old ABC-1\n+fixed for acme-corp\ncommit 4d5e6f\n+clean",
    });
    const result = await $.tool.call({command: "git push", tool: "Bash"});
    expect(result.deny).toContain("Found in: commit 1a2b3c.");
    expect(ran).toEqual([]);
  },
);

test(
  "private-terms lets a clean commit and push through",
  {options},
  async ($, on) => {
    const ran = engine(on, LAB, {
      grep: "src/b.ts:9:const abcd = 1",
      log: "commit 1a2b3c\n+clean",
    });
    await $.tool.call({command: "git commit -m x && git push", tool: "Bash"});
    expect(ran).toEqual(["Bash"]);
  },
);
