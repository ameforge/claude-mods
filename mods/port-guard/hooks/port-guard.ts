// A session that forgets its dev server is running starts another,
// which moves to the next free port or fails, and orphans pile up. Refuse the
// launch while its port is listened on, and name the holder.
// Idea from ghost-proc-guard in thieung/claude-mods (MIT).

export type Run = (
  argv: readonly string[],
) => Promise<{exitCode: number; stdout: string}>;

// A dir from a command, resolved against cwd; Git Bash's /d/ws reads as d:/ws.
const resolveDir = (dir: string, cwd: string) => {
  const path = dir.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:");
  return /^(?:[a-zA-Z]:)?[\\/]/.test(path) ? path : `${cwd}/${path}`;
};

const DEV_BYPASS = "# allow-dev-port";

const SCRIPT_RUN =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(dev|start|serve|preview|storybook)\b/;

// The tool's own port when the command names none; more specific first.
const DEFAULTS: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bvite\s+preview\b/, 4173],
  [/\bvite(?:\s+(?:dev|serve))?(?:\s+-|\s*$|\s+[^b\s])/, 5173],
  [/\bnext\s+(?:dev|start)\b/, 3000],
  [/\bastro\s+(?:dev|preview)\b/, 4321],
  [/\bnuxi?\s+dev\b/, 3000],
  [/\bremix\s+dev\b/, 3000],
  [/\bstorybook\s+dev\b/, 6006],
  [/\bwrangler\s+dev\b/, 8787],
  [/\bexpo\s+start\b/, 8081],
  [/\bwebpack(?:-dev-server|\s+serve)\b/, 8080],
  [/\brails\s+s(?:erver)?\b/, 3000],
  [/\buvicorn\b/, 8000],
  [/\bflask\s+run\b/, 5000],
  [/\bhttp\.server\b/, 8000],
  [/\bphp\s+-S\b/, 8000],
  [/\bhugo\s+server\b/, 1313],
  [/\bjekyll\s+serve\b/, 4000],
];

const explicitPort = (text: string) => {
  const m =
    /(?:--port[=\s]+|\s-p\s+|\bPORT=)(\d{2,5})\b/.exec(text) ??
    /\bhttp\.server\s+(\d{2,5})\b/.exec(text) ??
    /\bphp\s+-S\s+\S*:(\d{2,5})\b/.exec(text);
  return m ? Number(m[1]) : undefined;
};

const defaultPort = (text: string, atStart = false) =>
  DEFAULTS.find(([re]) => {
    const m = re.exec(text);
    return m !== null && (!atStart || m.index === 0);
  })?.[1];

// Settings and a runner before the tool: PORT=1 npx vite, uv run uvicorn, python -m http.server.
const LAUNCHER =
  /^(?:\w+=\S*\s+)*(?:(?:npx|pnpx|bunx|uvx)(?:\s+-\S+)*\s+|(?:npm|pnpm|yarn|bun|uv|poetry|pipenv|bundle)\s+(?:exec|dlx|x|run)\s+(?:--\s+)?|(?:pnpm|yarn)\s+|python3?\s+-m\s+)?(?:\S*[\\/])?/;

export const portOf = (text: string) => explicitPort(text) ?? defaultPort(text);

export type DevLaunch = {dir: string; port?: number; script?: string};

// The dev launches in a command, each with the folder it runs in (after a cd)
// and its port, or the package.json script that decides the port.
export const devLaunches = (command: string, cwd: string): DevLaunch[] => {
  if (command.trimEnd().endsWith(DEV_BYPASS)) return [];
  const launches: DevLaunch[] = [];
  let dir = cwd;
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/);
    if (/^(?:cd|pushd|Set-Location|sl)$/i.test(words[0] ?? "") && words[1])
      dir = resolveDir(words[1].replace(/^["']|["']$/g, ""), dir);
    // Quoted text is handed to a program (a commit message, an echo), not run.
    const run = segment.replace(/(["'])(?:\\.|(?!\1)[\s\S])*\1/g, "''");
    const script = SCRIPT_RUN.exec(run)?.[1];
    // The tool must be the command, so pnpm add vite or cd vite is no launch.
    const fallback = defaultPort(run.trim().replace(LAUNCHER, ""), true);
    if (script === undefined && fallback === undefined) continue;
    const port = explicitPort(run) ?? fallback;
    launches.push(port !== undefined ? {dir, port} : {dir, script});
  }
  return launches;
};

// The port a package.json script binds: its flag, else its tool's default.
// shortcut: a port set in vite/astro config or computed in code is not read; read the config if one slips by.
export const scriptPort = (packageJson: string, script: string) => {
  try {
    const body = JSON.parse(packageJson).scripts?.[script];
    return typeof body === "string" ? portOf(body) : undefined;
  } catch {
    return undefined;
  }
};

export type Holder = {pid: string; name: string};

// Windows: netstat lists every TCP socket; a listening one has a foreign
// address ending in :0, whatever language the state column is written in.
const windowsHolder = async (run: Run, port: number) => {
  const {stdout} = await run(["netstat", "-ano", "-p", "TCP"]);
  for (const line of stdout.split("\n")) {
    const m = /^\s*TCP\s+\S*:(\d+)\s+\S*:0\s+\S+\s+(\d+)\s*$/.exec(line);
    if (Number(m?.[1]) !== port || !m?.[2]) continue;
    const pid = m[2];
    const task = await run([
      "tasklist",
      "/FI",
      `PID eq ${pid}`,
      "/FO",
      "CSV",
      "/NH",
    ]).catch(() => ({exitCode: 1, stdout: ""}));
    return {name: /^"([^"]+)"/.exec(task.stdout.trim())?.[1] ?? "?", pid};
  }
  return undefined;
};

// macOS ships lsof; a Linux without it has ss.
const unixHolder = async (run: Run, port: number) => {
  try {
    const {stdout} = await run([
      "lsof",
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-Fpc",
    ]);
    const pid = /^p(\d+)$/m.exec(stdout)?.[1];
    if (pid) return {name: /^c(.+)$/m.exec(stdout)?.[1] ?? "?", pid};
    return undefined;
  } catch {
    const {stdout} = await run(["ss", "-ltnpH", `sport = :${port}`]);
    if (!stdout.trim()) return undefined;
    const m = /users:\(\("([^"]+)",pid=(\d+)/.exec(stdout);
    return {name: m?.[1] ?? "?", pid: m?.[2] ?? "?"};
  }
};

export const portHolder = (run: Run, port: number, isWindows: boolean) =>
  (isWindows ? windowsHolder(run, port) : unixHolder(run, port)).catch(
    () => undefined,
  );

export const devPortReason = (port: number, holder: Holder) =>
  `Port ${port} is already listened on by ${holder.name} (pid ${holder.pid}), likely a dev server started earlier. ` +
  "Reuse it, or stop it first. To start another one anyway, use a different port, " +
  `or append \`${DEV_BYPASS}\` to the command after the user confirms.`;
