// stage-guard: in a work tree several sessions share, `git add -A` or `git commit -a`
// would sweep in another session's work. The files dirty when this session started
// and never written by it through Write or Edit count as foreign.
import {gitCalls, type Run, statusFiles} from "./command-line";

export const STAGE_REASON =
  "this git command would also stage files changed before this session that it did not edit";
const SHOWN = 10;

const slash = (path: string) => path.replace(/\\/g, "/");

// A sweep: git add -A / --all / -u / --update / ., or git commit -a / --all / -am.
// The repo dir it runs in (git -C), "" for the session's cwd; null when none sweeps.
export const sweepDir = (command: string) => {
  for (const {args, dir, sub} of gitCalls(command)) {
    const sweeps =
      sub === "add"
        ? args.some((a) => ["-A", "--all", "-u", "--update", "."].includes(a))
        : sub === "commit" &&
          args.some((a) => a === "--all" || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a));
    if (sweeps) return dir ?? "";
  }
  return null;
};

// The repo root of dir and its dirty files, relative to that root; null outside a repo.
export const dirtyFiles = async (run: Run, dir: string) => {
  const top = await run(["git", "-C", dir, "rev-parse", "--show-toplevel"]);
  if (top.exitCode !== 0) return null;
  const root = slash(top.stdout.trim());
  const status = await run([
    "git",
    "-C",
    root,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  if (status.exitCode !== 0) return null;
  return {files: statusFiles(status.stdout), root};
};

// The dirty files that were dirty at the baseline and that the session never wrote.
export const foreignFiles = (
  files: string[],
  baseline: Set<string>,
  written: Set<string>,
  root: string,
) => {
  const prefix = `${root.toLowerCase()}/`;
  const mine = new Set(
    [...written]
      .map(slash)
      .filter((p) => p.toLowerCase().startsWith(prefix))
      .map((p) => p.slice(prefix.length).toLowerCase()),
  );
  return files.filter((f) => baseline.has(f) && !mine.has(f.toLowerCase()));
};

export const stageQuestion = (foreign: string[]) => {
  const more = foreign.length - SHOWN;
  const list = foreign.slice(0, SHOWN).join(", ");
  return `This git command would also stage ${foreign.length} file(s) changed before this session that it did not edit: ${list}${more > 0 ? `, and ${more} more` : ""}. Run it?`;
};
