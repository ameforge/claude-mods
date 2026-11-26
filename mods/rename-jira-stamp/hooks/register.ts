import type {EngineInterface, Register} from "claude-code";

const COMMAND = "rename-jira-stamp";

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const homeDir = async ($: EngineInterface) => {
  return (await $.env.get("USERPROFILE")) ?? (await $.env.get("HOME")) ?? "";
};

// Derived the way Claude Code names its project folders: classic.Stop, which
// carries the path, does not reach a plugin an organization's settings skip.
const transcriptPath = async ($: EngineInterface) => {
  const project = (await $.session.cwd()).replace(/[^a-zA-Z0-9]/g, "-");
  const configDir =
    (await $.env.get("CLAUDE_CONFIG_DIR")) ?? `${await homeDir($)}/.claude`;
  return `${configDir}/projects/${project}/${await $.session.id()}.jsonl`;
};

// The transcript rows that match `pattern`. rg reads a transcript of any size
// on Windows, macOS and Linux alike; without rg on PATH the whole file is
// read, which $.fs.read refuses past 4 MiB.
const transcriptRows = async ($: EngineInterface, pattern: string) => {
  const path = await transcriptPath($);
  try {
    const found = await $.process.run([
      "rg",
      "--no-config",
      "-e",
      pattern,
      "--",
      path,
    ]);
    if (found.exitCode <= 1) return found.stdout.split("\n");
  } catch {
    // no rg on PATH
  }
  const match = new RegExp(pattern);
  try {
    return String(await $.fs.read(path))
      .split("\n")
      .filter((row) => match.test(row));
  } catch {
    return [];
  }
};

// The name /rename last gave this session; /rename writes it to the
// transcript as a custom-title row, anywhere in the file.
const sessionTitle = async ($: EngineInterface) => {
  try {
    const rows = (await transcriptRows($, '"type":"custom-title"')).filter(
      (row) => row.trim() !== "",
    );
    const title = JSON.parse(rows[rows.length - 1] ?? "").customTitle;
    return typeof title === "string" && title.trim() !== ""
      ? title.trim()
      : undefined;
  } catch {
    return undefined;
  }
};

const pad = (n: number) => String(n).padStart(2, "0");

// Appended to the title: YYYYMMDD_HHMMSS, no spaces.
const titleStamp = (ms: number) => {
  const at = new Date(ms);
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `${date}_${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
};

// The title without stamps appended earlier, in this format or cache-handoff
// 0.4.0's "_YYYY-MM-DD HH:MM", so a title stamped again gets one fresh stamp
// instead of a growing chain.
const TRAILING_STAMP = /(?:_\d{8}_\d{6}|[_ ]\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/;

const baseTitle = (title: string) => {
  let base = title;
  while (TRAILING_STAMP.test(base)) base = base.replace(TRAILING_STAMP, "");
  return base;
};

// A ticket key in the name ("app-ticket-abc-101") becomes the whole base,
// upper-cased: ABC-101.
// shortcut: any word-dash-number counts (utf-8 too), tighten if a name trips it.
const TICKET_KEY = /(?<![a-z0-9])[a-z][a-z0-9]+-\d+(?!\d)/i;

const stampedTitle = (title: string, ms: number) => {
  const base = baseTitle(title);
  const key = TICKET_KEY.exec(base)?.[0].toUpperCase();
  return `${key ?? base}_${titleStamp(ms)}`;
};

// Upper-case KEY-123 shapes that are standards, not Jira tickets.
const NOT_TICKET = /^(?:CVE|HTTP|ISO|RFC|SHA|TLS|UTF)-/;

const KEY = /[A-Z][A-Z0-9]+-[0-9]+/g;

// The message of a transcript row that is the conversation itself: prompts,
// replies and tool results. Injected rows (CLAUDE.md attachments, request
// blobs, meta reminders, /rename echoes) are skipped, so an example key in the
// user's instructions or an earlier stamp does not name the ticket. Only the
// message counts: every row repeats metadata such as the git branch, which
// would otherwise outvote the ticket the conversation is about.
const conversationText = (row: string) => {
  try {
    const entry = JSON.parse(row);
    return (entry.type === "user" || entry.type === "assistant") &&
      entry.isMeta !== true
      ? JSON.stringify(entry.message ?? "")
      : undefined;
  } catch {
    return undefined;
  }
};

// The Jira key the conversation names most, the first seen on a tie: the
// ticket the conversation is about.
// shortcut: any other upper-case KEY-123 counts too, extend NOT_TICKET if one wins.
const transcriptTicket = async ($: EngineInterface) => {
  try {
    const counts = new Map<string, number>();
    for (const row of await transcriptRows($, KEY.source)) {
      const text = conversationText(row);
      if (text === undefined) continue;
      for (const [key] of text.matchAll(KEY)) {
        if (!NOT_TICKET.test(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    let ticket: string | undefined;
    let most = 0;
    for (const [key, count] of counts) {
      if (count > most) {
        ticket = key;
        most = count;
      }
    }
    return ticket;
  } catch {
    return undefined;
  }
};

// The name to stamp: the ticket the conversation names, else the session's
// name; /rename with no name lets Claude Code pick one when it has neither.
const nameSession = async ($: EngineInterface) => {
  const ticket = await transcriptTicket($);
  if (ticket !== undefined) return ticket;
  const title = await sessionTitle($);
  if (title !== undefined) return title;
  try {
    await $.command.run({command: "rename"});
    return await sessionTitle($);
  } catch (error) {
    $.ui.log(
      `${COMMAND}: could not name the conversation: ${errorText(error)}`,
    );
    return undefined;
  }
};

// The name typed, or the one nameSession picks, with a fresh stamp.
const renameStamped = async ($: EngineInterface, name: string) => {
  const title = name !== "" ? name : await nameSession($);
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
