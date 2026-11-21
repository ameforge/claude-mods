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

// Where a commit or push in a lab repo would publish a private term: files in
// the working tree (untracked ones too, so a file a shell script wrote counts)
// and, for a push, the patches of commits no remote has yet.
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
  // git grep finds candidates by plain text; the whole-word test is the pattern's.
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
  ]);
  for (const line of found.stdout.split("\n")) {
    const m = /^(.+?):\d+:(.*)$/.exec(line);
    if (m?.[1] && terms.test(m[2] ?? "")) places.add(m[1]);
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
