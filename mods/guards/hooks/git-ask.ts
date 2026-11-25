// git-ask: commit, push and PR creation ask first, except in a lab repo
// (origin owned by one of the labOwners setting). A command that moves elsewhere
// (cd, git -C) skips the ask only when every target is a lab repo too.
import {calls, gitCalls, type Run, resolveDir, runs} from "./command-line";

export const GIT_REASON =
  "git commit / push / gh pr create outside a lab repo needs confirmation";

// The origin pattern for owners listed with spaces or commas; null when none is set.
export const labOrigin = (owners: string) => {
  const names = owners
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return names.length ? new RegExp(`[:/](?:${names.join("|")})/`, "i") : null;
};

const isLabRepo = async (run: Run, lab: RegExp, dir: string) => {
  try {
    const {exitCode, stdout} = await run([
      "git",
      "-C",
      dir,
      "remote",
      "get-url",
      "origin",
    ]);
    return exitCode === 0 && lab.test(stdout.trim());
  } catch {
    return false;
  }
};

// The dirs the guarded commands run in, resolved against cwd.
const guardedDirs = (command: string, cwd: string) => [
  ...gitCalls(command)
    .filter((c) => c.sub === "commit" || c.sub === "push")
    .map((c) => resolveDir(c.dir, cwd)),
  ...calls(command)
    .filter((c) => runs(c, "gh", "pr", "create"))
    .map((c) => resolveDir(c.dir, cwd)),
];

export const needsGitAsk = async (
  command: string,
  cwd: string,
  run: Run,
  lab: RegExp | null,
) => {
  const dirs = guardedDirs(command, cwd);
  if (!dirs.length) return false;
  if (!lab) return true;
  for (const dir of new Set([cwd, ...dirs])) {
    if (!(await isLabRepo(run, lab, dir))) return true;
  }
  return false;
};
