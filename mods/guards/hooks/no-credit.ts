// no-credit: commit messages and PR descriptions carry no attribution.
import {calls, gitCalls, runs} from "./command-line";

// shortcut: reads the command line only, so a message from `git commit -F <file>` is not seen.
const CREDIT =
  /\bco-authored-by\s*:|\bgenerated (?:with|by) \[?claude\b|\u{1F916}/iu;
export const CREDIT_REASON =
  "Commit messages and PR descriptions carry no attribution here: remove the Co-Authored-By " +
  "trailer, the Generated with line and any emoji signature, then run the command again.";

// The dirs (undefined for the cwd) of each git commit, gh pr create and gh pr edit.
export const commitOrPrDirs = (command: string) => [
  ...gitCalls(command)
    .filter((c) => c.sub === "commit")
    .map((c) => c.dir),
  ...calls(command)
    .filter((c) => runs(c, "gh", "pr", "create") || runs(c, "gh", "pr", "edit"))
    .map((c) => c.dir),
];

export const hasCredit = (command: string) =>
  commitOrPrDirs(command).length > 0 && CREDIT.test(command);
