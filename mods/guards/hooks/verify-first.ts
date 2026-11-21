// verify-first: a final reply that lists unchecked items is blocked once, so
// the agent checks what it can before handing the list over.
// START: the phrase opens a line (after an optional bullet, number, heading or bold marker).
// LABEL: the phrase sits in the first 40 chars of a line and ends in a colon.
// Neither fires when "none" or "không có" follows the colon, nor on a phrase quoted mid-sentence.
const UNCHECKED =
  "(?:chưa (?:được )?(?:kiểm tra|đối chiếu|xác minh)|not (?:checked|done|verified))";
const NONE = String.raw`[ \t]*(?:\*\*|__)?[ \t]*(?:không có|none|nothing|n\/a)`;
const START = new RegExp(
  String.raw`^[ \t]*(?:[-*+]|\d+[.)]|#+)?[ \t]*(?:\*\*|__)?[ \t]*${UNCHECKED}(?![^:\n]{0,20}:${NONE})`,
  "im",
);
const LABEL = new RegExp(
  String.raw`^.{0,40}?${UNCHECKED}[^:\n]{0,20}:(?!${NONE})`,
  "im",
);
export const VERIFY_REASON =
  "For each unchecked item, verify it now if a read-only or local action in this session can " +
  "(read code, run tests or scripts locally, read-only MCP or DB query). Never write to external " +
  "systems, deploy, or access production to verify; for those, keep the item and ask the user one " +
  "question. Then rewrite the list with only what remains and why.";

export const listsUnchecked = (text: string) =>
  START.test(text) || LABEL.test(text);
