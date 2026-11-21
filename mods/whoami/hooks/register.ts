import type {EngineInterface, Register} from "claude-code";

// No $.session API names the session; ListAgents' text is the only source.
const NAME = /This session is (\S+) \[(\w+)\]/;

// shortcut: /rename raises no event, so a new name shows from the next turn on.
let shown: string | undefined;

const showName = async ($: EngineInterface) => {
  try {
    const listed = await $.tool.call({tool: "ListAgents"});
    const name = listed.text?.match(NAME)?.[1];
    if (name === shown) return;
    shown = name;
    $.ui.status(name);
  } catch {
    // A failed lookup leaves the status line as it was.
  }
};

export const register: Register = (on) => {
  shown = undefined;
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    await showName($);
    return started;
  });

  on("turn.start", async ($, e, next) => {
    const started = await next(e);
    await showName($);
    return started;
  });
};
