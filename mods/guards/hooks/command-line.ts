// How the guards read a shell command line: the commands it chains, the folder
// each runs in after a cd, and the git calls among them.

export type Run = (
  argv: readonly string[],
) => Promise<{exitCode: number; stdout: string}>;

// dir is the folder a cd before the command points at, undefined for the cwd.
export type Call = {dir?: string; words: string[]};

export type GitCall = {args: string[]; dir?: string; sub: string};

const unquote = (token: string) => token.replace(/^["']|["']$/g, "");

const isAbsolute = (dir: string) => /^(?:[a-zA-Z]:)?[\\/]/.test(dir);
const under = (base: string | undefined, dir: string) =>
  base === undefined || isAbsolute(dir) ? dir : `${base}/${dir}`;

// A dir from a command, resolved against cwd; Git Bash's /d/ws reads as d:/ws.
export const resolveDir = (dir: string | undefined, cwd: string) =>
  dir ? under(cwd, dir.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:")) : cwd;

// Each command in a command line, split on && || ; | and newlines, with the
// dir a cd before it points at. A dir holding $ or ~ is kept as written, so
// git fails to find it and the guards stand aside or ask.
export const calls = (command: string): Call[] => {
  const found: Call[] = [];
  let here: string | undefined;
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment
      .trim()
      .replace(/^\(\s*|\s*\)$/g, "")
      .split(/\s+/)
      .map(unquote);
    if (/^(?:cd|pushd|Set-Location|sl)$/i.test(words[0] ?? "") && words[1])
      here = under(here, words[1]);
    found.push({dir: here, words});
  }
  return found;
};

// The call runs the program and subcommands given, such as gh pr create.
export const runs = (call: Call, ...prefix: string[]) => {
  const at = call.words.indexOf(prefix[0] ?? "");
  return at >= 0 && prefix.every((word, i) => call.words[at + i] === word);
};

// Each git invocation, with the dir its git -C points at under any cd; -c
// settings and other global flags are skipped to reach the subcommand.
export const gitCalls = (command: string): GitCall[] =>
  calls(command).flatMap(({dir: here, words}) => {
    let i = words.indexOf("git");
    if (i < 0) return [];
    let dir = here;
    for (i++; i < words.length; i++) {
      const w = words[i] ?? "";
      if (w === "-C") dir = under(here, words[++i] ?? "");
      else if (w === "-c") i++;
      else if (!w.startsWith("-")) break;
    }
    return [{args: words.slice(i + 1), dir, sub: words[i] ?? ""}];
  });

// The paths in `git status --porcelain=v1` output; a rename lists its new path.
export const statusFiles = (stdout: string) =>
  stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).replace(/^.* -> /, ""));
