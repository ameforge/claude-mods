// git-preview: before a git command that throws away uncommitted work runs
// (reset --hard, stash, stash drop / clear, clean, checkout -- / ., restore,
// switch --discard-changes), list the files or stashes it would touch so the
// person can allow or cancel it.
import type {Run} from "./git-ask";

export const PREVIEW_REASON =
  "this git command would discard uncommitted changes";
const SHOWN = 10;

type Step =
  | {kind: "status"; dir?: string; paths: string[]; untracked: boolean}
  | {kind: "clean"; dir?: string; args: string[]}
  | {kind: "stashes"; dir?: string; ref?: string};

const unquote = (token: string) => token.replace(/^["']|["']$/g, "");

// Words after `--`, or the non-flag words when there is no `--`.
const pathArgs = (args: string[]) => {
  const dash = args.indexOf("--");
  if (dash >= 0) return args.slice(dash + 1);
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "-s" || a === "--source") i++;
    else if (!a.startsWith("-")) paths.push(a);
  }
  return paths;
};

const has = (args: string[], ...flags: string[]) =>
  args.some((a) => flags.includes(a));

// One git invocation as the step that previews it, or null when it keeps the work tree.
const stepFor = (sub: string, args: string[], dir?: string): Step | null => {
  const status = (paths: string[], untracked = false): Step => ({
    dir,
    kind: "status",
    paths,
    untracked,
  });
  switch (sub) {
    case "reset":
      return has(args, "--hard") ? status([]) : null;
    case "stash": {
      const verb = args[0] && !args[0].startsWith("-") ? args[0] : "push";
      if (verb === "clear") return {dir, kind: "stashes"};
      if (verb === "drop")
        return {dir, kind: "stashes", ref: args[1] ?? "stash@{0}"};
      if (verb !== "push" && verb !== "save") return null;
      const rest = verb === args[0] ? args.slice(1) : args;
      const untracked = has(rest, "-u", "--include-untracked", "-a", "--all");
      return status(rest.includes("--") ? pathArgs(rest) : [], untracked);
    }
    case "checkout":
      if (has(args, "-f", "--force")) return status([]);
      if (args.includes("--")) return status(pathArgs(args));
      return args.includes(".") ? status(["."]) : null;
    case "restore": {
      const staged = has(args, "--staged", "-S");
      if (staged && !has(args, "--worktree", "-W")) return null;
      return status(pathArgs(args));
    }
    case "switch":
      return has(args, "--discard-changes", "-f", "--force")
        ? status([])
        : null;
    case "clean":
      return has(args, "-n", "--dry-run")
        ? null
        : {args: args.filter((a) => a !== "--force"), dir, kind: "clean"};
    default:
      return null;
  }
};

export type GitCall = {args: string[]; dir?: string; sub: string};

const isAbsolute = (dir: string) => /^(?:[a-zA-Z]:)?[\\/]/.test(dir);
const under = (base: string | undefined, dir: string) =>
  base === undefined || isAbsolute(dir) ? dir : `${base}/${dir}`;

// A dir from a command, resolved against cwd; Git Bash's /d/ws reads as d:/ws.
export const resolveDir = (dir: string | undefined, cwd: string) =>
  dir ? under(cwd, dir.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:")) : cwd;

// Each git invocation in a command line, split on && || ; | and newlines, with
// the dir that a `cd` before it and its own `git -C` point at. A dir holding
// $ or ~ is kept as written, so git fails to find it and the guards stand aside.
export const gitCalls = (command: string): GitCall[] => {
  const calls: GitCall[] = [];
  let here: string | undefined;
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/).map(unquote);
    if (/^(?:cd|pushd|Set-Location|sl)$/i.test(words[0] ?? "") && words[1])
      here = under(here, words[1]);
    let i = words.indexOf("git");
    if (i < 0) continue;
    let dir = here;
    for (i++; i < words.length; i++) {
      const w = words[i] ?? "";
      if (w === "-C") dir = under(here, words[++i] ?? "");
      else if (w === "-c") i++;
      else if (!w.startsWith("-")) break;
    }
    calls.push({args: words.slice(i + 1), dir, sub: words[i] ?? ""});
  }
  return calls;
};

export const destructiveSteps = (command: string): Step[] =>
  gitCalls(command).flatMap((c) => stepFor(c.sub, c.args, c.dir) ?? []);

const lines = (stdout: string) => stdout.split("\n").filter(Boolean);

const filesFor = async (run: Run, step: Step, cwd: string) => {
  const base = [
    "git",
    "-c",
    "core.quotePath=false",
    "-C",
    resolveDir(step.dir, cwd),
  ];
  if (step.kind === "stashes") {
    // clear drops every entry, drop the one ref: `stash@{0}: WIP on main: ...`.
    const {exitCode, stdout} = await run([...base, "stash", "list"]);
    if (exitCode !== 0) return [];
    const ref = step.ref;
    return ref
      ? lines(stdout).filter((l) => l.startsWith(`${ref}:`))
      : lines(stdout);
  }
  if (step.kind === "clean") {
    // -f/-i dropped, -n added: `clean -fdx` previews as `clean -n -dx`.
    const flags = step.args.map((a) =>
      /^-[a-zA-Z]+$/.test(a) ? a.replace(/[fi]/g, "") : a,
    );
    const {exitCode, stdout} = await run([
      ...base,
      "clean",
      "-n",
      ...flags.filter((a) => a !== "-" && a !== "--interactive"),
    ]);
    return exitCode === 0
      ? lines(stdout).map((l) => l.replace(/^Would remove /, ""))
      : [];
  }
  const {exitCode, stdout} = await run([
    ...base,
    "status",
    "--porcelain=v1",
    step.untracked ? "--untracked-files=all" : "--untracked-files=no",
    "--",
    ...step.paths,
  ]);
  return exitCode === 0 ? lines(stdout).map((l) => l.slice(3)) : [];
};

// The files a command's destructive git steps would touch; empty when none would.
export const previewFiles = async (command: string, cwd: string, run: Run) => {
  const files = new Set<string>();
  for (const step of destructiveSteps(command)) {
    try {
      for (const f of await filesFor(run, step, cwd)) files.add(f);
    } catch {
      // A failed preview leaves the command to git, which fails the same way.
    }
  }
  return [...files];
};

export const previewQuestion = (files: string[]) => {
  const more = files.length - SHOWN;
  const list = files.slice(0, SHOWN).map((f) => `  ${f}`);
  if (more > 0) list.push(`  and ${more} more`);
  return `This git command would discard ${files.length} file(s) or stash(es):\n${list.join("\n")}\n\nRun it?`;
};
