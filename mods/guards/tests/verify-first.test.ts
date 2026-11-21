import type {On} from "claude-code";
import {expect, test} from "claude-code/testing";

// The engine beneath the mod ends each turn and records the prompts it is handed.
const engine = (on: On) => {
  const prompts: string[] = [];
  on("turn.complete", () => ({text: ""}));
  on("prompt.submit", (_$, e) => {
    prompts.push(e.text);
    return {text: e.text};
  });
  return prompts;
};

const answer = {durationMs: 1000, isAborted: false, reason: "answer"};

test("verify-first follows up an answer that lists unchecked items", async ($, on) => {
  const prompts = engine(on);
  for (const text of [
    "Done.\n\nNot checked:\n- the Windows path",
    "- **Not verified**: the CI run",
    "Những gì chưa kiểm tra: build trên CI",
  ]) {
    await $.turn.complete({...answer, answer: text} as never);
    // The follow-up's own answer ends the round.
    await $.turn.complete({...answer, answer: "Not checked: x"} as never);
  }
  expect(prompts.length).toBe(3);
  expect(prompts[0]).toContain("verify it now");
});

test("verify-first leaves clean answers, subagents and interrupts alone", async ($, on) => {
  const prompts = engine(on);
  for (const text of [
    "Done.\n\nNot checked: none",
    "The old hook printed not checked items too.",
    "All green.",
  ]) {
    await $.turn.complete({...answer, answer: text} as never);
  }
  const unchecked = "Not checked:\n- the Windows path";
  await $.turn.complete({...answer, agentId: "a1", answer: unchecked} as never);
  await $.turn.complete({
    ...answer,
    answer: unchecked,
    isAborted: true,
    reason: "aborted",
  } as never);
  expect(prompts).toEqual([]);
});
