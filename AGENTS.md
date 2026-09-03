# Agent Instructions

> Operating manual and engineering standards for autonomous AI coding agents working in this repository.

## 1. Zero-Leakage Security & Secrets Hygiene

- **Environment variables only**: Store all configuration, tokens, and credentials strictly in `.env`.
- **Never commit secrets**: Zero tolerance for raw API keys, Telegram bot tokens, database URLs, webhook tokens, passwords, private keys (`*.pem`, `*.key`), or sensitive server paths in committed code, tests, docs, or logs.
- **Maintain `.env.example`**: When introducing a new configuration key, immediately add a sanitized placeholder in `.env.example` with dummy values.
- **Pre-commit secret audit**: Before staging or committing, inspect `git status` and `git diff --cached` to verify no secret or un-ignored credential file is being committed.

## 2. Git & GitHub Delivery Lifecycle

Every non-trivial fix or feature must follow the 6-stage lifecycle:

```
Issue (gh issue create)
  └── Branch (feat/fix/refactor)
        └── Implement & Verify (syntax + test)
              └── Commit (Conventional Commits)
                    └── PR (gh pr create)
                          └── Squash & Merge (gh pr merge)
```

### Stage 1: Issue Tracking
- Always trace work to a GitHub Issue.
- Check existing issues: `gh issue list`.
- If starting new work without an issue, create one first: `gh issue create --title "<type>: <summary>" --body "..."`.

### Stage 2: Branching Strategy
- **Never commit or push directly to `main`**.
- Branch from latest `main`: `git checkout main && git pull origin main`.
- Create a structured branch:
  - Features: `feat/<issue-id>-<short-slug>`
  - Bug fixes: `fix/<issue-id>-<short-slug>`
  - Refactoring: `refactor/<short-slug>`
  - Documentation: `docs/<short-slug>`

### Stage 3: Local Verification Gate
- Before staging any code, run all project verification commands locally:
  - Syntax check: `npm run check:syntax`
  - Tests: `npm test`
- All checks must pass with **zero warnings and zero errors**. Do not push failing code.

### Stage 4: Conventional Commits
- Commit messages must follow Conventional Commits:
  - `feat: <description>` (new features or bot commands)
  - `fix: <description>` (bug fixes or patch handling)
  - `refactor: <description>` (restructuring without behavioral change)
  - `test: <description>` (adding or modifying tests)
  - `docs: <description>` (documentation updates)
  - `chore: <description>` (tooling, dependencies, or maintenance)
- Reference the issue number when applicable (e.g. `feat: add ping command (#12)`).

### Stage 5: Pull Request & Review
- Push feature branch: `git push -u origin <branch-name>`.
- Open a Pull Request:
  ```bash
  gh pr create --title "<type>: <summary>" --body "Closes #<issue-number>"
  ```
- Review the diff (`gh pr diff` or run `/code-review`). Ensure automated CI checks pass.

### Stage 6: Squash & Merge
- Merge via squash once approved and verified:
  ```bash
  gh pr merge <pr-number> --squash --delete-branch
  ```
- Switch back to `main` and pull updates: `git checkout main && git pull origin main`.

## 3. Engineering & Architectural Standards

- **Command isolation**: Bot commands live in `commands/` and export a handler function. Do not bloat `bot.js`.
- **Access control**: Commands and sensitive actions must be guarded by whitelist middleware (`config/middleware.js` / `AUTHORIZED_TELEGRAM_ID`).
- **Resilient execution**: Shell executions (`commands/sh.js`) must sanitize inputs, prevent command injection, and set execution timeouts.

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage vocabulary (5 default roles). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (`CONTEXT.md` and `docs/adr/` at repo root). See `docs/agents/domain.md`.
