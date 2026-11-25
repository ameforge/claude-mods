import type {EngineInterface, Register} from "claude-code";
import {allowRules, isAllowed, SETTINGS_FILES} from "./allowed";
import {type Run, resolveDir} from "./command-line";
import {GIT_REASON, labOrigin, needsGitAsk} from "./git-ask";
import {PREVIEW_REASON, previewFiles, previewQuestion} from "./git-preview";
import {BULLET_REASON, hasBullet} from "./no-bullet";
import {CREDIT_REASON, commitOrPrDirs, hasCredit} from "./no-credit";
import {breaksPlainMd, MD_REASON} from "./plain-md";
import {
  fileDir,
  leaksPrivate,
  PRIVATE_REASON,
  privateTermPattern,
  repoLeaks,
  repoReason,
  termWords,
} from "./private-terms";
import {isRecursiveGrep, RG_REASON} from "./rg-only";
import {
  dirtyFiles,
  foreignFiles,
  STAGE_REASON,
  stageQuestion,
  sweepDir,
} from "./stage-guard";
import {listsUnchecked, VERIFY_REASON} from "./verify-first";

// A command the session folder's .claude settings allow skips the asking guards.
// shortcut: allow rules in ~/.claude/settings.json are not read; read them too if a global allow should quiet the guards.
const allowedHere = async (
  $: EngineInterface,
  tool: string,
  command: string,
) => {
  const cwd = await $.session.cwd();
  const texts = await Promise.all(
    SETTINGS_FILES.map((file) =>
      $.fs.read(`${cwd}/.claude/${file}`).catch(() => ""),
    ),
  );
  return isAllowed(command, allowRules(texts.map(String), tool));
};

// What a guard decides: let the call on, deny it, or ask Run or Cancel first,
// with the deny a Cancel gets.
type Verdict = {deny: string} | {ask: string; declined: string} | undefined;
type Guard = [name: string, check: () => Verdict | Promise<Verdict>];

// The guards in order, minus those the off setting names. A deny ends the run;
// an ask opens the mod's own dialog from tool.call (where cc-plugin-sec-default
// is seated it skips a plugin's classic hooks and tool.check, so a returned ask
// never reaches the person) unless the allow rules cover the command, and a
// failed dialog counts as Cancel.
const runGuards = async (
  $: EngineInterface,
  guards: Guard[],
  allowed: () => Promise<boolean>,
) => {
  for (const [, check] of guards) {
    const verdict = await check();
    if (verdict === undefined) continue;
    if ("deny" in verdict) return verdict;
    if (await allowed()) continue;
    const answer = await $.ui
      .ask(verdict.ask, ["Run", "Cancel"])
      .catch(() => "Cancel");
    if (answer !== "Run") return {deny: verdict.declined};
  }
  return undefined;
};

const gitAsk = async (
  $: EngineInterface,
  command: string,
  lab: RegExp | null,
): Promise<Verdict> => {
  const run: Run = (argv) => $.process.run(argv);
  if (!(await needsGitAsk(command, await $.session.cwd(), run, lab))) return;
  return {ask: `${GIT_REASON}. Run it?`, declined: `Declined: ${GIT_REASON}`};
};

// The files a destructive git command would touch.
const gitPreview = async (
  $: EngineInterface,
  command: string,
): Promise<Verdict> => {
  const run: Run = (argv) => $.process.run(argv);
  const files = await previewFiles(command, await $.session.cwd(), run);
  if (!files.length) return;
  return {ask: previewQuestion(files), declined: `Declined: ${PREVIEW_REASON}`};
};

// stage-guard state: per repo root, the files dirty at session start; the paths
// this session wrote through Write or Edit.
type Stage = {baseline: Map<string, Set<string>>; written: Set<string>};

const takeBaseline = async ($: EngineInterface, cwd: string, s: Stage) => {
  const dirty = await dirtyFiles((argv) => $.process.run(argv), cwd).catch(
    () => null,
  );
  if (dirty && !s.baseline.has(dirty.root))
    s.baseline.set(dirty.root, new Set(dirty.files));
};

// A sweep that would stage foreign files asks first. A repo first seen at the sweep
// (another repo than the session's start, through git -C or cd) takes its dirty
// files as the baseline, so only what this session wrote passes without asking.
const stageGuard = async (
  $: EngineInterface,
  command: string,
  s: Stage,
): Promise<Verdict> => {
  const dir = sweepDir(command);
  if (dir === null) return;
  const target = resolveDir(dir, await $.session.cwd());
  const dirty = await dirtyFiles((argv) => $.process.run(argv), target).catch(
    () => null,
  );
  if (!dirty) return;
  const baseline = s.baseline.get(dirty.root) ?? new Set(dirty.files);
  s.baseline.set(dirty.root, baseline);
  const foreign = foreignFiles(dirty.files, baseline, s.written, dirty.root);
  if (!foreign.length) return;
  const mine = dirty.files.filter((f) => !foreign.includes(f));
  return {
    ask: stageQuestion(foreign),
    declined: `Declined: ${STAGE_REASON}. Stage this session's files by name${mine.length ? `: git add ${mine.join(" ")}` : ""}.`,
  };
};

type Guarded = {lab: RegExp | null; terms: RegExp | null; words: string[]};

// A commit or PR command line holding a private term, run in a lab repo.
const commitLeaks = async ($: EngineInterface, command: string, g: Guarded) => {
  const cwd = await $.session.cwd();
  for (const dir of new Set(commitOrPrDirs(command))) {
    const at = resolveDir(dir, cwd);
    if (
      await leaksPrivate(
        (argv) => $.process.run(argv),
        command,
        at,
        g.terms,
        g.lab,
      )
    )
      return true;
  }
  return false;
};

// A commit message or PR text holding a private term, or a commit or push that
// would publish one from the repo's files: the deny, or undefined.
const gitLeaks = async ($: EngineInterface, command: string, g: Guarded) => {
  if (await commitLeaks($, command, g)) return {deny: PRIVATE_REASON};
  const places = await repoLeaks(
    (argv) => $.process.run(argv),
    command,
    await $.session.cwd(),
    g.words,
    g.terms,
    g.lab,
  );
  return places.length ? {deny: repoReason(places)} : undefined;
};

// Text a Write or Edit adds to a file in a lab repo, holding a private term.
const fileLeaks = async (
  $: EngineInterface,
  path: string,
  text: string,
  g: Guarded,
): Promise<Verdict> =>
  (await leaksPrivate(
    (argv) => $.process.run(argv),
    text,
    fileDir(path),
    g.terms,
    g.lab,
  ))
    ? {deny: PRIVATE_REASON}
    : undefined;

export const register: Register = (on, options) => {
  // Guards named in the `off` setting stand aside, e.g. the asking ones in a vibe repo.
  const off = new Set(termWords(String(options.off ?? "")));
  const lab = labOrigin(String(options.labOwners ?? ""));
  const privateTerms = String(options.privateTerms ?? "");
  const g: Guarded = {
    lab,
    terms: privateTermPattern(privateTerms),
    words: termWords(privateTerms),
  };
  const stage: Stage = {baseline: new Map(), written: new Set()};
  const isOn = (guards: Guard[]) => guards.filter(([name]) => !off.has(name));

  // The baseline is taken once per repo, so a /clear keeps the first one.
  on("session.start", async ($, e, next) => {
    await takeBaseline($, e.cwd, stage);
    return next(e);
  });

  on("tool.call", {tool: ["Bash", "PowerShell"]}, async ($, e, next) => {
    const {command, tool} = e;
    let allowed: Promise<boolean> | undefined;
    // shortcut: rg-only watches Bash only, as its README row says; add PowerShell if grep -r shows up there.
    const guards = isOn([
      [
        "rg-only",
        () =>
          tool === "Bash" && isRecursiveGrep(command)
            ? {deny: RG_REASON}
            : undefined,
      ],
      [
        "no-credit",
        () => (hasCredit(command) ? {deny: CREDIT_REASON} : undefined),
      ],
      ["private-terms", () => gitLeaks($, command, g)],
      ["git-preview", () => gitPreview($, command)],
      ["stage-guard", () => stageGuard($, command, stage)],
      ["git-ask", () => gitAsk($, command, lab)],
    ]);
    return (
      (await runGuards($, guards, () => {
        allowed ??= allowedHere($, tool, command);
        return allowed;
      })) ?? next(e)
    );
  });

  on("tool.call", {tool: ["Write", "Edit"]}, async ($, e, next) => {
    const path = e.file_path;
    const text = e.tool === "Write" ? e.content : e.new_string;
    const guards = isOn([
      [
        "plain-md",
        () => (breaksPlainMd(path, text) ? {deny: MD_REASON} : undefined),
      ],
      [
        "no-bullet",
        () => (hasBullet(text) ? {deny: BULLET_REASON} : undefined),
      ],
      ["private-terms", () => fileLeaks($, path, text, g)],
    ]);
    const denied = await runGuards($, guards, async () => false);
    if (denied) return denied;
    stage.written.add(path);
    return next(e);
  });

  // A main-loop answer that lists unchecked items gets one follow-up prompt;
  // the answer to that prompt is never followed up again.
  let isFollowingUp = false;
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId !== undefined || e.reason !== "answer") return result;
    if (isFollowingUp) isFollowingUp = false;
    else if (!off.has("verify-first") && listsUnchecked(e.answer)) {
      isFollowingUp = true;
      void $.prompt.submit({text: VERIFY_REASON});
    }
    return result;
  });
};
