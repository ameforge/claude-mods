import {expect, test} from "claude-code/testing";
import {devLaunches, portHolder, scriptPort} from "../hooks/dev-port";

const CWD = "D:/ws/app";

const out = (stdout: string, exitCode = 0) =>
  Promise.resolve({exitCode, stdout});

test("dev-port finds dev launches, their folder and port", () => {
  expect(devLaunches("pnpm dev", CWD)).toEqual([{dir: CWD, script: "dev"}]);
  expect(devLaunches("cd web && npm run dev -- --port 5174", CWD)).toEqual([
    {dir: `${CWD}/web`, port: 5174},
  ]);
  expect(devLaunches("PORT=4000 next dev", CWD)).toEqual([
    {dir: CWD, port: 4000},
  ]);
  expect(devLaunches("python -m http.server 9000", CWD)).toEqual([
    {dir: CWD, port: 9000},
  ]);
  expect(devLaunches("npx vite", CWD)).toEqual([{dir: CWD, port: 5173}]);
  // Not launches: another program's -p, quoted text, the bypass.
  expect(devLaunches("ssh -p 2222 host", CWD)).toEqual([]);
  expect(devLaunches('git commit -m "fix next dev"', CWD)).toEqual([]);
  expect(devLaunches("pnpm build", CWD)).toEqual([]);
  expect(devLaunches("pnpm dev # allow-dev-port", CWD)).toEqual([]);
});

test("dev-port reads the port of a package.json script", () => {
  const pkg = JSON.stringify({
    scripts: {dev: "vite --port 5175", start: "next start", test: "vitest"},
  });
  expect(scriptPort(pkg, "dev")).toBe(5175);
  expect(scriptPort(pkg, "start")).toBe(3000);
  expect(scriptPort(pkg, "serve")).toBeUndefined();
  expect(scriptPort("not json", "dev")).toBeUndefined();
});

test("dev-port names the holder on Windows, macOS and Linux", async () => {
  const windows = (argv: readonly string[]) =>
    argv[0] === "netstat"
      ? out(
          [
            "  Proto  Local Address  Foreign Address  State  PID",
            "  TCP    0.0.0.0:5173   0.0.0.0:0        ABHÖREN  4242",
            "  TCP    127.0.0.1:50000  127.0.0.1:5173 ESTABLISHED 77",
          ].join("\r\n"),
        )
      : out('"node.exe","4242","Console","1","80,000 K"\r\n');
  expect(await portHolder(windows, 5173, true)).toEqual({
    name: "node.exe",
    pid: "4242",
  });
  expect(await portHolder(windows, 3000, true)).toBeUndefined();

  const mac = (argv: readonly string[]) =>
    argv.includes("-iTCP:3000") ? out("p501\ncnode\n") : out("", 1);
  expect(await portHolder(mac, 3000, false)).toEqual({
    name: "node",
    pid: "501",
  });
  expect(await portHolder(mac, 3001, false)).toBeUndefined();

  // A Linux without lsof falls back to ss.
  const linux = (argv: readonly string[]) =>
    argv[0] === "lsof"
      ? Promise.reject(new Error("not found"))
      : out(
          argv[2] === "sport = :8000"
            ? 'LISTEN 0 511 *:8000 *:* users:(("python3",pid=900,fd=3))\n'
            : "",
        );
  expect(await portHolder(linux, 8000, false)).toEqual({
    name: "python3",
    pid: "900",
  });
  expect(await portHolder(linux, 8001, false)).toBeUndefined();
});

// The engine path: a pnpm dev whose script port is taken is denied, a free one runs.
test("dev-port denies a launch whose port is taken", async ($, on) => {
  const ran: string[] = [];
  on("tool.call", (_$, e) => {
    if (e.tool === "Bash") ran.push(e.command);
    return {result: "ok"} as never;
  });
  on("session.cwd", () => ({value: CWD}) as never);
  on(
    "env.get",
    (_$, e) => ({value: e.name === "OS" ? "Windows_NT" : undefined}) as never,
  );
  on(
    "fs.read",
    () => ({value: JSON.stringify({scripts: {dev: "vite"}})}) as never,
  );
  on("process.run", (_$, e) =>
    e.argv[0] === "netstat"
      ? ({
          value: {
            exitCode: 0,
            stderr: "",
            stdout: "  TCP  [::]:5173  [::]:0  LISTENING  31\n",
          },
        } as never)
      : ({
          value: {exitCode: 0, stderr: "", stdout: '"node.exe","31"\n'},
        } as never),
  );
  const denied = await $.tool.call({command: "pnpm dev", tool: "Bash"});
  await $.tool.call({command: "pnpm dev --port 5180", tool: "Bash"});
  expect(denied.deny).toContain("Port 5173");
  expect(denied.deny).toContain("node.exe (pid 31)");
  expect(ran).toEqual(["pnpm dev --port 5180"]);
});
