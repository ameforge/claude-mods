import type {EngineInterface, Register} from "claude-code";

// No $.session API names the session; ListAgents' text is the only source.
const NAME = /This session is (\S+) \[(\w+)\]/;

const lookUpName = async ($: EngineInterface) => {
  try {
    const listed = await $.tool.call({tool: "ListAgents"});
    return listed.text?.match(NAME)?.[1];
  } catch {
    return undefined;
  }
};

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    await $.command.register({
      description:
        "Show this session's name, the address other sessions use with SendMessage",
      immediate: true,
      name: "whoami",
    });
    return started;
  });

  on("command.run", {command: "whoami"}, async ($) => ({
    isTextDisplayOnly: true,
    text:
      (await lookUpName($)) ??
      "This session's name could not be read from ListAgents.",
  }));
};
