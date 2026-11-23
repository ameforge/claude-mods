// private-terms: work identifiers (ticket prefixes, client names, work domains)
// stay out of a lab repo, whose code is public. The terms come from the
// privateTerms setting, so they are never written into this code either.

export const PRIVATE_REASON =
  "This is a lab repo, so its content is public, and the text holds a private term from the " +
  "guards privateTerms setting. Replace it with a made-up example (ABC-101, acme), then try again.";

const escapeTerm = (term: string) =>
  term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One case-insensitive pattern for terms listed with spaces or commas, each
// matched as a whole word (KJ1 matches KJ1-42, not KJ12); null when none is set.
export const termWords = (terms: string) =>
  terms.split(/[\s,]+/).filter(Boolean);

export const privateTermPattern = (terms: string) => {
  const words = termWords(terms).map(escapeTerm);
  return words.length
    ? new RegExp(`(?<![a-z0-9])(?:${words.join("|")})(?![a-z0-9])`, "i")
    : null;
};

// The folder that holds a file, for either slash.
export const fileDir = (path: string) =>
  path.replace(/[\\/][^\\/]*$/, "") || ".";

type Run = (
  argv: readonly string[],
) => Promise<{exitCode: number; stdout: string}>;

// The origin of the repo holding dir, tried up to three parents up so a file
// in a folder not made yet still counts; empty when there is none.
const repoOrigin = async (run: Run, dir: string) => {
  let at = dir;
  for (let i = 0; i < 4; i++, at = fileDir(at)) {
    try {
      const {exitCode, stdout} = await run([
        "git",
        "-C",
        at,
        "remote",
        "get-url",
        "origin",
      ]);
      if (exitCode === 0) return stdout.trim();
    } catch {
      // no git on PATH
    }
  }
  return "";
};

// True when text holds a private term and dir is in a lab repo; the repo is
// only looked up once a term matches, so most writes cost nothing.
export const leaksPrivate = async (
  run: Run,
  text: string,
  dir: string,
  terms: RegExp | null,
  lab: RegExp | null,
) =>
  Boolean(
    terms && lab && terms.test(text) && lab.test(await repoOrigin(run, dir)),
  );

const GIT_PUBLISH = /\bgit\s+(?:-C\s+\S+\s+)?(commit|push)\b/;

export const repoReason = (places: string[]) =>
  `${PRIVATE_REASON} Found in: ${places.slice(0, 10).join(", ")}.`;

// git's empty tree, the base to diff against before the first commit.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// Where a commit or push in a lab repo would publish a private term: lines
// added since HEAD (staged or not, since `git add -A && git commit` stages in
// the same command), untracked files (so a file a shell script wrote counts)
// and, for a push, the patches of commits no remote has yet. Text already in
// HEAD is not scanned again.
// shortcut: checks the session folder's repo only, not a cd or git -C target.
export const repoLeaks = async (
  run: Run,
  command: string,
  dir: string,
  words: string[],
  terms: RegExp | null,
  lab: RegExp | null,
) => {
  const verb = GIT_PUBLISH.exec(command)?.[1];
  if (!(verb && terms) || !lab?.test(await repoOrigin(run, dir))) return [];
  const places = new Set<string>();
  const diff = (base: string) =>
    run(["git", "-C", dir, "diff", "-U0", "--no-color", "--no-ext-diff", base]);
  let changed = await diff("HEAD");
  if (changed.exitCode !== 0) changed = await diff(EMPTY_TREE);
  let file = "";
  for (const line of changed.stdout.split("\n")) {
    if (line.startsWith("+++ ")) file = line.replace(/^\+\+\+ (b\/)?/, "");
    else if (line.startsWith("+") && terms.test(line)) places.add(file);
  }
  const untracked = (
    await run(["git", "-C", dir, "ls-files", "--others", "--exclude-standard"])
  ).stdout
    .split("\n")
    .filter(Boolean);
  if (untracked.length) {
    // git grep finds candidates by plain text; the whole-word test is the pattern's.
    // shortcut: every untracked path goes on one command line, split it if a repo ever holds thousands.
    const found = await run([
      "git",
      "-C",
      dir,
      "grep",
      "-I",
      "-i",
      "-n",
      "--untracked",
      "-F",
      ...words.flatMap((word) => ["-e", word]),
      "--",
      ...untracked,
    ]);
    for (const line of found.stdout.split("\n")) {
      const m = /^(.+?):\d+:(.*)$/.exec(line);
      if (m?.[1] && terms.test(m[2] ?? "")) places.add(m[1]);
    }
  }
  if (verb === "push") {
    const log = await run([
      "git",
      "-C",
      dir,
      "log",
      "-p",
      "--format=commit %h",
      "HEAD",
      "--not",
      "--remotes",
    ]);
    let commit = "";
    for (const line of log.stdout.split("\n")) {
      if (line.startsWith("commit ")) commit = line.slice(7);
      else if (
        line.startsWith("+") &&
        !line.startsWith("+++") &&
        terms.test(line)
      )
        places.add(`commit ${commit}`);
    }
  }
  return [...places];
};
