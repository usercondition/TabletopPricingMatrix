# AGENTS.md

## Cursor Cloud specific instructions

This repository is a placeholder with no application code, package manifests, or services. Tracked content is the `terst` file plus Cloud Agent config under `.cursor/`.

### Environment config (repo-hosted)

Cloud Agent bootstrap is defined in `.cursor/environment.json` (install is a no-op: `true`). There is no `start` command and no long-running services.

### Services

None. There is nothing to start, lint, test, or run as an app.

### Dependency refresh

Do not add package installs until real project manifests exist. Keep `install` a successful no-op.

### Smoke checks

- Confirm checkout: `ls -la` and `cat terst` (contents should be `test`).
- Confirm git: `git status` on the working branch.
- Confirm env file: `cat .cursor/environment.json`.
