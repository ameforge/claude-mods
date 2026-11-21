import type {EngineInterface, Register} from "claude-code";
import {
  devLaunches,
  devPortReason,
  portHolder,
  type Run,
  scriptPort,
} from "./port-guard";

// A dev launch whose port is already listened on is denied, naming the holder.
const devPort = async ($: EngineInterface, command: string) => {
  const launches = devLaunches(command, await $.session.cwd());
  if (!launches.length) return;
  const run: Run = (argv) => $.process.run(argv);
  const isWindows = (await $.env.get("OS")) === "Windows_NT";
  for (const launch of launches) {
    const port =
      launch.port ??
      scriptPort(
        await $.fs.read(`${launch.dir}/package.json`).catch(() => ""),
        launch.script ?? "",
      );
    if (port === undefined) continue;
    const holder = await portHolder(run, port, isWindows);
    if (holder) return {deny: devPortReason(port, holder)};
  }
};

export const register: Register = (on) => {
  on(
    "tool.call",
    {tool: "Bash"},
    async ($, e, next) => (await devPort($, e.command)) ?? next(e),
  );
  on(
    "tool.call",
    {tool: "PowerShell"},
    async ($, e, next) => (await devPort($, e.command)) ?? next(e),
  );
};
