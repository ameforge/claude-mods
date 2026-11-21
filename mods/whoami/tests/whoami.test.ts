import type {On} from "claude-code";
import {expect, type TestBody, test} from "claude-code/testing";

// The engine beneath the mod: ListAgents answers with `listing.text`, and
// every status line the mod sets is recorded.
const engine = (on: On, text: string) => {
  const listing = {statuses: [] as (string | undefined)[], text};
  on("session.start", (_$, e) => ({cwd: e.cwd}));
  on("turn.start", (_$, e) => ({turnId: e.turnId}));
  on("tool.call", {tool: "ListAgents"}, () => ({
    result: {sections: []},
    text: listing.text,
  }));
  on("ui.status", (_$, e) => {
    listing.statuses.push(e.text);
    return {value: undefined};
  });
  return listing;
};

const listed = (name: string) =>
  `This session is ${name} [40c18f] — the name other sessions use to message it.`;

const start = ($: Parameters<TestBody>[0]) =>
  $.session.start({cwd: "D:/ws/demo", isInteractive: true, surface: null});

test("shows the session name from ListAgents on the status line", async ($, on) => {
  const listing = engine(on, listed("claude-mods-95"));
  await start($);
  await $.turn.start({text: "hi", turnId: "t1"});
  expect(listing.statuses).toEqual(["claude-mods-95"]);
});

test("shows the new name from the first turn after a /rename", async ($, on) => {
  const listing = engine(on, listed("claude-mods-95"));
  await start($);
  listing.text = listed("vibe-setup-skill-config");
  await $.turn.start({text: "hi", turnId: "t1"});
  expect(listing.statuses).toEqual([
    "claude-mods-95",
    "vibe-setup-skill-config",
  ]);
});

test("shows nothing when ListAgents' text no longer matches", async ($, on) => {
  const listing = engine(on, "No other sessions are running.");
  await start($);
  expect(listing.statuses).toEqual([]);
});
