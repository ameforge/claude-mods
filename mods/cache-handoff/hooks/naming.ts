// Same bytes in cache-handoff and rename-jira-stamp; pnpm test checks it.

// The engine reached through closures, since $ cannot cross a module import.
export type TranscriptIo = {
  log: (text: string) => unknown;
  path: string;
  read: (path: string) => Promise<unknown>;
  rename: () => Promise<unknown>;
  run: (argv: readonly string[]) => Promise<{exitCode: number; stdout: string}>;
};

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const pad = (n: number) => String(n).padStart(2, "0");

// The transcript rows that match `pattern`. rg reads a transcript of any size
// on Windows, macOS and Linux alike; without rg on PATH the whole file is
// read, which $.fs.read refuses past 4 MiB.
const transcriptRows = async (io: TranscriptIo, pattern: string) => {
  try {
    const found = await io.run([
      "rg",
      "--no-config",
      "-e",
      pattern,
      "--",
      io.path,
    ]);
    if (found.exitCode <= 1) return found.stdout.split("\n");
  } catch {
    // no rg on PATH
  }
  const match = new RegExp(pattern);
  try {
    return String(await io.read(io.path))
      .split("\n")
      .filter((row) => match.test(row));
  } catch {
    return [];
  }
};

// The name /rename last gave this session; /rename writes it to the
// transcript as a custom-title row, anywhere in the file.
const sessionTitle = async (io: TranscriptIo) => {
  try {
    const rows = (await transcriptRows(io, '"type":"custom-title"')).filter(
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

export const stampedTitle = (title: string, ms: number) => {
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
const transcriptTicket = async (io: TranscriptIo) => {
  try {
    const counts = new Map<string, number>();
    for (const row of await transcriptRows(io, KEY.source)) {
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
export const nameSession = async (io: TranscriptIo) => {
  const ticket = await transcriptTicket(io);
  if (ticket !== undefined) return ticket;
  const title = await sessionTitle(io);
  if (title !== undefined) return title;
  try {
    await io.rename();
    return await sessionTitle(io);
  } catch (error) {
    io.log(`could not name the conversation: ${errorText(error)}`);
    return undefined;
  }
};
