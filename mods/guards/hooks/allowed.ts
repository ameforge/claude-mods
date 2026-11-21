// A command the person already allowed in the repo's permission rules runs
// without a guard's own Run or Cancel dialog, the way Claude Code itself skips
// its prompt for it.

export const SETTINGS_FILES = ["settings.json", "settings.local.json"];

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `git add:*` is a prefix; `*` anywhere else matches any text.
const ruleRegex = (rule: string) =>
  new RegExp(
    rule.endsWith(":*")
      ? `^${escapeRegex(rule.slice(0, -2))}(?:\\s[\\s\\S]*)?$`
      : `^${rule.split("*").map(escapeRegex).join("[\\s\\S]*")}$`,
  );

// The allow rules for a tool across the settings texts; a bare `Bash` allows all.
export const allowRules = (texts: readonly string[], tool: string) =>
  texts.flatMap((text) => {
    try {
      const allow: unknown = JSON.parse(text).permissions?.allow;
      if (!Array.isArray(allow)) return [];
      return allow.flatMap((rule) => {
        if (rule === tool) return [/[\s\S]*/];
        const m = new RegExp(`^${tool}\\(([\\s\\S]*)\\)$`).exec(String(rule));
        return m?.[1] ? [ruleRegex(m[1])] : [];
      });
    } catch {
      return [];
    }
  });

// Every part of a command line (split on && || ; | and newlines, quoted text
// set aside) matches an allow rule.
export const isAllowed = (command: string, rules: readonly RegExp[]) => {
  const parts = command
    .replace(/(["'])(?:\\.|(?!\1)[\s\S])*\1/g, "''")
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (
    parts.length > 0 &&
    parts.every((part) => rules.some((rule) => rule.test(part)))
  );
};
