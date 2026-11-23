import type {On} from "claude-code";
import {expect, test} from "claude-code/testing";

const LAB = "D:/ws/lab";
const WORK = "D:/ws/work";
const ORIGINS: Record<string, string> = {
  [LAB]: "git@github.com:labowner/tools.git\n",
  [WORK]: "https://github.com/acme/app.git\n",
};
const options = {labOwners: "labowner", privateTerms: "ABC, acme-corp"};

type Repo = {diff?: string; grep?: string; log?: string; untracked?: string};

// The engine beneath the mod: a session in cwd, `git remote get-url` answered
// from ORIGINS, `git diff`, `git ls-files`, `git grep` and `git log` from repo,
// and every tool call it is handed collected. `git grep` is answered only when
// it is limited to untracked paths, as a whole-tree scan is a regression.
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
    const answers: Record<string, string | undefined> = {
      diff: repo.diff,
      grep: e.argv.includes("--") ? repo.grep : "",
      log: repo.log,
      "ls-files": repo.untracked,
    };
    const stdout = verb === "remote" ? origin : answers[verb ?? ""];
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
  "private-terms denies a commit when a changed or untracked file holds a term, however it was written",
  {options},
  async ($, on) => {
    const ran = engine(on, LAB, {
      diff: "diff --git a/src/c.ts b/src/c.ts\n--- a/src/c.ts\n+++ b/src/c.ts\n@@ -1 +1 @@\n-old\n+see acme-corp",
      grep: "notes/a.md:3:see ABC-12\nnotes/b.md:9:const abcd = 1",
      untracked: "notes/a.md\nnotes/b.md\n",
    });
    const result = await $.tool.call({
      command: "git add -A && git commit -m x",
      tool: "Bash",
    });
    expect(result.deny).toContain("Found in: src/c.ts, notes/a.md.");
    expect(ran).toEqual([]);
  },
);

test(
  "private-terms lets a commit through when a term sits only in text HEAD already holds or a removed line",
  {options},
  async ($, on) => {
    const ran = engine(on, LAB, {
      diff: "diff --git a/old.md b/old.md\n--- a/old.md\n+++ b/old.md\n@@ -3 +3 @@\n-see ABC-12\n+see the ticket",
      grep: "old.md:3:see ABC-12",
    });
    await $.tool.call({command: "git commit -am x", tool: "Bash"});
    expect(ran).toEqual(["Bash"]);
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
