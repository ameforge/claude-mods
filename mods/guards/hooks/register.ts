import type {EngineInterface, Register} from "claude-code";
import {GIT_REASON, labOrigin, needsGitAsk, type Run} from "./git-ask";
import {
  PREVIEW_REASON,
  previewFiles,
  previewQuestion,
  resolveDir,
} from "./git-preview";
import {CREDIT_REASON, hasCredit, isCommitOrPr} from "./no-credit";
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

// git-ask asks in its own dialog from tool.call: where cc-plugin-sec-default is
// seated it skips a plugin's classic hooks and tool.check, so a returned ask
// never reaches the person.
const gitAsk = async (
  $: EngineInterface,
  command: string,
  lab: RegExp | null,
) => {
  const run: Run = (argv) => $.process.run(argv);
  if (!(await needsGitAsk(command, await $.session.cwd(), run, lab))) return;
  const answer = await $.ui
    .ask(`${GIT_REASON}. Run it?`, ["Run", "Cancel"])
    .catch(() => "Cancel");
  return answer === "Run" ? undefined : {deny: `Declined: ${GIT_REASON}`};
};

// git-preview asks the same way: the files a destructive git command would touch, Run or Cancel.
const gitPreview = async ($: EngineInterface, command: string) => {
  const run: Run = (argv) => $.process.run(argv);
  const files = await previewFiles(command, await $.session.cwd(), run);
  if (!files.length) return;
  const answer = await $.ui
    .ask(previewQuestion(files), ["Run", "Cancel"])
    .catch(() => "Cancel");
  return answer === "Run" ? undefined : {deny: `Declined: ${PREVIEW_REASON}`};
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
const stageGuard = async ($: EngineInterface, command: string, s: Stage) => {
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
  const answer = await $.ui
    .ask(stageQuestion(foreign), ["Run", "Cancel"])
    .catch(() => "Cancel");
  if (answer === "Run") return;
  const mine = dirty.files.filter((f) => !foreign.includes(f));
  return {
    deny: `Declined: ${STAGE_REASON}. Stage this session's files by name${mine.length ? `: git add ${mine.join(" ")}` : ""}.`,
  };
};

type Guarded = {lab: RegExp | null; terms: RegExp | null; words: string[]};

// A commit or PR command line holding a private term, run in a lab repo.
const commitLeaks = async ($: EngineInterface, command: string, g: Guarded) =>
  isCommitOrPr(command) &&
  leaksPrivate(
    (argv) => $.process.run(argv),
    command,
    await $.session.cwd(),
    g.terms,
    g.lab,
  );

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
const fileLeaks = (
  $: EngineInterface,
  path: string,
  text: string,
  g: Guarded,
) =>
  leaksPrivate(
    (argv) => $.process.run(argv),
    text,
    fileDir(path),
    g.terms,
    g.lab,
  );

export const register: Register = (on, options) => {
  const lab = labOrigin(String(options.labOwners ?? ""));
  const privateTerms = String(options.privateTerms ?? "");
  const g: Guarded = {
    lab,
    terms: privateTermPattern(privateTerms),
    words: termWords(privateTerms),
  };
  const stage: Stage = {baseline: new Map(), written: new Set()};

  // The baseline is taken once per repo, so a /clear keeps the first one.
  on("session.start", async ($, e, next) => {
    await takeBaseline($, e.cwd, stage);
    return next(e);
  });

  on("tool.call", {tool: "Bash"}, async ($, e, next) => {
    if (isRecursiveGrep(e.command)) return {deny: RG_REASON};
    if (hasCredit(e.command)) return {deny: CREDIT_REASON};
    const leak = await gitLeaks($, e.command, g);
    if (leak) return leak;
    return (
      (await gitPreview($, e.command)) ??
      (await stageGuard($, e.command, stage)) ??
      (await gitAsk($, e.command, lab)) ??
      next(e)
    );
  });

  on("tool.call", {tool: "PowerShell"}, async ($, e, next) => {
    if (hasCredit(e.command)) return {deny: CREDIT_REASON};
    const leak = await gitLeaks($, e.command, g);
    if (leak) return leak;
    return (
      (await gitPreview($, e.command)) ??
      (await stageGuard($, e.command, stage)) ??
      (await gitAsk($, e.command, lab)) ??
      next(e)
    );
  });

  on("tool.call", {tool: "Write"}, async ($, e, next) => {
    if (breaksPlainMd(e.file_path, e.content)) return {deny: MD_REASON};
    if (await fileLeaks($, e.file_path, e.content, g))
      return {deny: PRIVATE_REASON};
    stage.written.add(e.file_path);
    return next(e);
  });

  on("tool.call", {tool: "Edit"}, async ($, e, next) => {
    if (breaksPlainMd(e.file_path, e.new_string)) return {deny: MD_REASON};
    if (await fileLeaks($, e.file_path, e.new_string, g))
      return {deny: PRIVATE_REASON};
    stage.written.add(e.file_path);
    return next(e);
  });

  // A main-loop answer that lists unchecked items gets one follow-up prompt;
  // the answer to that prompt is never followed up again.
  let isFollowingUp = false;
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId !== undefined || e.reason !== "answer") return result;
    if (isFollowingUp) isFollowingUp = false;
    else if (listsUnchecked(e.answer)) {
      isFollowingUp = true;
      void $.prompt.submit({text: VERIFY_REASON});
    }
    return result;
  });
};
