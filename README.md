# claude-mods

Claude Code mods by ame, published as the plugin marketplace `amemods`.

## Mods

| Mod                                           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [cache-handoff](mods/cache-handoff/README.md) | Saves you from paying to re-cache a long conversation after you step away. While the prompt cache is still warm it writes a short handoff note, and once the cache has gone cold it opens a fresh conversation that starts from that note. The old conversation stays whole for `claude --resume`.                                                                                                                                                                                                                                                                     |
| cache-keepalive                               | Keeps an idle conversation's prompt cache warm with a tiny forked request shortly before it would expire, for up to 3 idle hours by default, so you can come back later without re-caching the whole transcript.                                                                                                                                                                                                                                                                                                                                                       |
| guards                                        | Shared guards that turn agent rules into checks. `rg-only` blocks recursive grep and points the agent to rg. `git-ask` asks before git commit, git push or gh pr create outside a lab repo, one whose origin an owner in the `labOwners` setting owns. `git-preview` lists the files a git reset --hard, stash, clean, checkout or restore would discard and asks before it runs. `verify-first` stops a reply that lists unchecked items once, so the agent checks what it can first. `plain-md` keeps bold and italic out of markdown files, `no-credit` keeps attribution trailers out of commits and PRs, and `private-terms` keeps the words in the `privateTerms` setting out of lab repos. |
| rename-jira-stamp                             | `/rename-jira-stamp [name]` renames the conversation to the Jira ticket it mentions most, such as `ABC-101_20261121_171500`, or to the name you give, plus a fresh timestamp. With no ticket it stamps the current name.                                                                                                                                                                                                                                                                                                                                               |
| whoami                                        | Shows this session's name, the address other sessions use with SendMessage, on the status line, so you can tell a peer where to reach it. Costs no tokens.                                                                                                                                                                                                                                                                                                                                                                                                             |

## Install

Add the marketplace once, then install any mod from it:

```
/plugin marketplace add ameforge/claude-mods
/plugin install cache-handoff@amemods
```

The mods need a Claude Code build that supports mods (hooks modules loaded from `hooks/hooks.json`). Each mod's README covers its commands and settings.

## Develop

Clone the repo and add it as a local marketplace. An installed mod is then read straight from the clone, so an edit reaches a session after `/reload-plugins`, with no reinstall:

```
claude plugin marketplace add <path to your clone>
claude plugin install cache-handoff@amemods
```

Check a mod before committing:

```
claude plugin validate mods/<mod>
claude plugin test mods/<mod>
tsc -p mods/<mod>
```

The engine writes `mods/<mod>/.claude-plugin/types/` once it loads the mod; that folder is not committed.
