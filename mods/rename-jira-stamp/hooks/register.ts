import type {EngineInterface, Register} from "claude-code";
import {
  errorText,
  nameSession,
  stampedTitle,
  type TranscriptIo,
} from "./naming";

const COMMAND = "rename-jira-stamp";

const homeDir = async ($: EngineInterface) => {
  return (await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME")) ?? "";
};

// Derived the way Claude Code names its project folders: classic.Stop, which
// carries the path, does not reach a plugin an organization's settings skip.
const transcriptPath = async ($: EngineInterface) => {
  const project = (await $.session.root()).replace(/[^a-zA-Z0-9]/g, "-");
  const configDir =
    (await $.env.get("CLAUDE_CONFIG_DIR")) ?? `${await homeDir($)}/.claude`;
  return `${configDir}/projects/${project}/${await $.session.id()}.jsonl`;
};

const transcriptIo = async ($: EngineInterface): Promise<TranscriptIo> => ({
  log: (text) => $.ui.log(`${COMMAND}: ${text}`),
  path: await transcriptPath($),
  read: (path) => $.fs.read(path),
  rename: () => $.command.run({command: "rename"}),
  run: (argv) => $.process.run(argv),
});

// The name typed, or the one nameSession picks, with a fresh stamp.
const renameStamped = async ($: EngineInterface, name: string) => {
  const title = name !== "" ? name : await nameSession(await transcriptIo($));
  if (title === undefined) {
    $.ui.toast(`${COMMAND}: the conversation has no name to stamp.`);
    return;
  }
  await $.command.run({
    args: stampedTitle(title, await $.clock.now()),
    command: "rename",
  });
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    // A refused name must not stop the rest of session.start.
    try {
      await $.command.register({
        argumentHint: "[name]",
        description:
          "Rename this conversation to its Jira ticket, or the name given, plus a timestamp",
        name: COMMAND,
      });
    } catch (error) {
      $.ui.toast(
        `${COMMAND}: could not register the slash command: ${errorText(error)}`,
      );
    }
    return next(e);
  });

  on("command.run", {command: COMMAND}, ($, e) => {
    // $.command.run waits for the session to be idle, so this runs just after.
    $.clock.after(0, () => {
      renameStamped($, e.args.trim()).catch((error) =>
        $.ui.toast(`${COMMAND}: could not rename: ${errorText(error)}`),
      );
    });
    return {text: "Renaming the conversation with a timestamp."};
  });
};
