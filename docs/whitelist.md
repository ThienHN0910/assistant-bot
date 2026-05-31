# Whitelist commands

This document describes the shell command whitelist used by the bot. The bot exposes a single command handler `sh` which accepts predefined aliases (short commands) and executes a safe sequence of system commands configured in `config/whitelist.js`.

Usage
- From Telegram chat: `/sh /deploy` or `/sh /pm2-restart assistant-bot`
- If no alias provided, the bot replies with the list of available aliases.

Available aliases (configured in `config/whitelist.js`)

- `git-status` — runs `git status`
- `git-pull` — runs `git pull origin main`
- `npm-install` — runs `npm install`
- `npm-build` — runs `npm run build`
- `deploy` — runs `git pull origin main`, `npm install`, `npm run build`, `pm2 restart all`
- `nginx-test` — runs `sudo nginx -t` (requires sudo privileges configured on server)
- `nginx-reload` — runs `sudo systemctl reload nginx`
- `nginx-status` — runs `sudo systemctl status nginx`
- `pm2-list` — runs `pm2 list`
- `pm2-restart <app>` — runs `pm2 restart <app>` (app must be one of the allowed apps in `config/whitelist.js`)

Security notes
- Commands are executed without a shell using `child_process.spawn`, which avoids shell interpolation and common injection vectors.
- `config/whitelist.js` explicitly maps aliases to arrays of `{ cmd, args }` steps; arbitrary commands are not accepted.
- For commands that accept arguments (for example `pm2-restart <app>`), the value is validated against `allowedApps` in the same config file.
- Commands that require `sudo` are included but the bot does not bypass OS authentication; configure `sudoers` appropriately if you want passwordless execution for specific commands.

Extending the whitelist
- Edit `config/whitelist.js` to add or modify aliases.
- If adding a new alias that accepts arguments, include `requiresArg: true` and `argName` in the step and add any validation in `lib/whitelist.js` (for more complex rules).

Developer notes
- `lib/whitelist.js` exposes `listAliases()` and `getCommands(alias, args)`.
- `lib/runner.js` exposes `runSequence(list, opts)` which executes steps sequentially and returns per-step results.
