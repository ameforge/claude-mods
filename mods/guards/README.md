# guards

Each guard lives in its own file under `hooks/`. `hooks/register.ts` wires them to the engine and holds no logic of its own.

| Guard         | File               | Event                                                      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| rg-only       | `rg-only.ts`       | `tool.call` Bash                                           | Denies recursive grep (`grep -r`, `-R`, `--recursive`) and points the agent to `rg` or the Grep tool. Grep on one file or a pipe passes.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| git-ask       | `git-ask.ts`       | `tool.call` Bash, PowerShell                               | Asks before git commit, git push and gh pr create run, except in a lab repo. The ask is the mod's own dialog (Run or Cancel); Cancel, or closing it, denies the call. A command that moves elsewhere (`cd`, `git -C`) skips the ask only when every target is a lab repo too.                                                                                                                                                                                                                                                                                      |
| git-preview   | `git-preview.ts`   | `tool.call` Bash, PowerShell                               | Before git reset --hard, stash (push or save), clean, checkout -- or ., checkout -f, restore (not --staged alone), switch --discard-changes, stash drop or stash clear runs, lists the files or stashes it would discard (from git status, git clean -n or git stash list) and asks Run or Cancel. Nothing to discard, no ask. Follows git -C and a cd before git. Idea from worktree-guard in thieung/claude-mods (MIT).                                                                                                                                          |
| stage-guard   | `stage-guard.ts`   | `session.start`, `tool.call` Bash, PowerShell, Write, Edit | At session start, records the files already dirty in the repo; a repo first reached later through git -C or cd takes its dirty files at the first sweep. Before git add -A, --all, -u, . or git commit -a runs, asks Run or Cancel when it would stage any of those files that this session never wrote through Write or Edit; the deny names `git add` with this session's files instead. A file changed only by a shell command (sed, a formatter) counts as foreign. Follows git -C and a cd before git. Idea from worktree-guard in thieung/claude-mods (MIT). |
| verify-first  | `verify-first.ts`  | `turn.complete`                                            | When a main-loop answer lists unchecked items ("Not checked:", "chÃ†Â°a kiÃ¡Â»Æ’m tra"), sends one follow-up prompt asking the agent to verify what it can locally and keep only what is left. The answer to that prompt is not followed up again.                                                                                                                                                                                                                                                                                                                 |
| plain-md      | `plain-md.ts`      | `tool.call` Write, Edit                                    | Denies bold and italic in the text a Write or Edit adds to a `.md` file. Code fences and inline code are ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| no-credit     | `no-credit.ts`     | `tool.call` Bash, PowerShell                               | Denies a git commit, gh pr create or gh pr edit whose command line carries a Co-Authored-By trailer, a "Generated with Claude" line or a robot emoji.                                                                                                                                                                                                                                                                                                                                                                                                              |
| private-terms | `private-terms.ts` | `tool.call` Bash, PowerShell, Write, Edit                  | In a lab repo, denies a Write or Edit whose added text, or a git commit or gh pr command line, holds a word from the `privateTerms` setting (whole word, any case). A git commit or push is also denied while any file in the repo holds one, untracked files included, so a file written by a shell script is caught too; a push also checks the commits no remote has yet. The deny names where each word was found.                                                                                                                                             |

## Settings

| Setting        | Default | Used by                                                                                                                                                                                   |
| -------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `labOwners`    | empty   | git-ask. GitHub owners of your own repos, separated by spaces or commas. A repo whose `origin` one of them owns is a lab repo. Left empty, git-ask asks in every repo.                    |
| `privateTerms` | empty   | private-terms. Words that must never reach a lab repo, such as a work ticket prefix, a client name or a work email domain, separated by spaces or commas. Left empty, nothing is checked. |

Set them with `/plugin configure guards@amemods`, or in `settings.json`:

```json
"pluginConfigs": {
  "guards@amemods": {"options": {"labOwners": "your-user your-org", "privateTerms": "ABC acme"}}
}
```

## Bypass

rg-only lets a command through when it ends with `# allow-grep-r`.

## Why no classic hooks

On Team, Enterprise and managed machines, `cc-plugin-sec-default` skips every `classic.*` hook of a plugin it does not manage. It skips their `tool.check` hooks too, so an ask returned from there never reaches the person. So git-ask asks in its own dialog from `tool.call` instead of `classic.PreToolUse`, and verify-first uses `turn.complete` with `$.prompt.submit` instead of blocking `classic.Stop`.

## Known limits

- no-credit reads the command line only, so a message passed with `git commit -F <file>` is not checked.
- git-ask treats a move target it cannot resolve (`$HOME`, `~`, `%VAR%`) as a work repo and asks.
- private-terms checks the repo of the session folder, not a `git -C` or `cd` target. A file a shell writes is caught at the next commit or push, not when it is written.
- verify-first matches English and Vietnamese phrasings only.
