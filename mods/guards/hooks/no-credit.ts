// no-credit: commit messages and PR descriptions carry no attribution.
// shortcut: reads the command line only, so a message from `git commit -F <file>` is not seen.
const CREDITED_CMD =
  /\bgit\s+(?:-C\s+\S+\s+)?commit\b|\bgh\s+pr\s+(?:create|edit)\b/;
const CREDIT =
  /\bco-authored-by\s*:|\bgenerated (?:with|by) \[?claude\b|\u{1F916}/iu;
export const CREDIT_REASON =
  "Commit messages and PR descriptions carry no attribution here: remove the Co-Authored-By " +
  "trailer, the Generated with line and any emoji signature, then run the command again.";

export const isCommitOrPr = (command: string) => CREDITED_CMD.test(command);

export const hasCredit = (command: string) =>
  isCommitOrPr(command) && CREDIT.test(command);
