// rg-only: recursive grep is single-threaded and walks ignored and binary
// files, so point the agent to rg. Grep on one file or a pipe is left alone.
const RECURSIVE_SHORT = /^-[a-zA-Z]*[rR][a-zA-Z]*$/;
const RECURSIVE_LONG = /^--(dereference-)?recursive$/;
const GREP_CMD = /^(?:sudo\s+|command\s+)?[ef]?grep(?:\s+(.*))?$/;
const RG_BYPASS = "# allow-grep-r";
export const RG_REASON =
  "Recursive grep is blocked: use `rg -n <pattern> [path]` (multithreaded, much faster) " +
  "or the built-in Grep tool. rg skips gitignored and hidden files by default; add -u (ignored), " +
  "-uu (+hidden) or -uuu (+binary) when the target may be excluded. " +
  `If grep -r is truly required, append \`${RG_BYPASS}\` to the command.`;

const isRecursiveFlag = (token: string) =>
  RECURSIVE_SHORT.test(token) || RECURSIVE_LONG.test(token);

const isRecursiveSegment = (segment: string) => {
  const args = segment.trim().match(GREP_CMD)?.[1];
  if (!args) return false;
  const tokens = args.split(/\s+/);
  const end = tokens.indexOf("--");
  return (end === -1 ? tokens : tokens.slice(0, end)).some(isRecursiveFlag);
};

export const isRecursiveGrep = (command: string) =>
  !command.includes(RG_BYPASS) &&
  command.split(/[;&|\n]|\$\(|`/).some(isRecursiveSegment);
