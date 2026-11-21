// git-ask: commit, push and PR creation ask first, except in a lab repo
// (origin owned by one of the labOwners setting). A command that moves elsewhere
// (cd, git -C) skips the ask only when every target is a lab repo too.
const GIT_GUARDED =
  /\bgit\s+(?:-C\s+\S+\s+)?(?:commit|push)\b|\bgh\s+pr\s+create\b/;
const MOVE_TARGET =
  /(?:(?:^|[;&|(\s])(?:cd|pushd|Set-Location|sl)|\bgit\s+-C)\s+("[^"]*"|'[^']*'|[^\s;&|)]+)?/g;
export const GIT_REASON =
  "git commit / push / gh pr create outside a lab repo needs confirmation";

export type Run = (
  argv: readonly string[],
) => Promise<{exitCode: number; stdout: string}>;

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

// The move targets as paths resolved against cwd; null when one cannot be read.
const moveTargets = (command: string, cwd: string) => {
  const dirs: string[] = [];
  for (const m of command.matchAll(MOVE_TARGET)) {
    const dir = m[1]?.replace(/^["']|["']$/g, "");
    if (!dir || /[$`~%]/.test(dir)) return null;
    const native = dir.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:"); // Git Bash /d/ws -> d:/ws
    dirs.push(
      /^(?:[a-zA-Z]:)?[\\/]/.test(native) ? native : `${cwd}/${native}`,
    );
  }
  return dirs;
};

export const needsGitAsk = async (
  command: string,
  cwd: string,
  run: Run,
  lab: RegExp | null,
) => {
  if (!GIT_GUARDED.test(command)) return false;
  const dirs = moveTargets(command, cwd);
  if (!(lab && dirs)) return true;
  for (const dir of [cwd, ...dirs]) {
    if (!(await isLabRepo(run, lab, dir))) return true;
  }
  return false;
};
