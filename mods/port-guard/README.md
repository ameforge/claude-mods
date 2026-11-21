# port-guard

Keeps a session from starting a second dev server when one already runs. Without it, a session that forgets its server is running starts another, which moves to the next free port or fails, and orphaned servers pile up.

## What it does

Before a Bash or PowerShell command that launches a dev server runs (`npm run dev`, `pnpm dev`, `vite`, `next dev`, `astro dev`, `wrangler dev`, `uvicorn`, `python -m http.server` and similar), the mod works out the port it will bind:

1. A port in the command (`--port 5174`, `-p 5174`, `PORT=5174`).
2. Else the port in the `package.json` script it runs.
3. Else the tool's default port, such as 5173 for vite or 3000 for next.

When that port is already listened on, the launch is denied and the reason names the process and its pid, so the agent reuses the server, stops it, or picks another port. A `cd` before the launch is followed.

To start another server anyway, the agent appends `# allow-dev-port` to the command after you confirm.

## Platforms

| OS      | How the port holder is read                  |
| ------- | -------------------------------------------- |
| Windows | `netstat -ano`, then `tasklist` for the name |
| macOS   | `lsof`                                       |
| Linux   | `lsof`, or `ss` where lsof is not installed  |

## Known limits

- A port set in a vite or astro config file, or computed in code, is not read; the tool's default is assumed.
- Only commands Claude runs are checked, not a server started from your own terminal.

Idea from ghost-proc-guard in thieung/claude-mods (MIT).
