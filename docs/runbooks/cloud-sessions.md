# Cloud sessions (Claude Code on the web)

How to work on Spolu from claude.ai/code instead of the local CLI. Facts are from the Claude Code docs as of 2026-10-16: [web](https://code.claude.com/docs/en/claude-code-on-the-web), [cloud environments](https://code.claude.com/docs/en/cloud-environments).

## What the repo already provides

- `CLAUDE.md`, the project skills and the vendored plugin skills in `.claude/skills/` (see `.claude/skills/THIRD_PARTY.md`). Cloud sessions do not load plugins, so the skills live in the repo.
- A `SessionStart` hook (`.claude/settings.json` → `scripts/cloud-session.sh`). It does nothing locally. In a cloud session (`CLAUDE_CODE_REMOTE=true`) it:
  - creates `.env` from `.env.example`;
  - installs dependencies if they are missing;
  - starts the Docker daemon if needed;
  - starts PostgreSQL 17 and Mailpit from `docker-compose.dev.yml`.

  It never fails the session start: it logs what went wrong.
- The owner's open briefs in [../superpowers/briefs/](../superpowers/briefs/) and the roadmap.

What cloud sessions do not have:
- the owner's `~/.claude` settings and memory;
- RTK;
- local MCP servers.

## One-time setup (owner)

1. **Connect the repo.**
   1. Open https://claude.ai/code and sign in.
   2. Connect GitHub. This installs the Claude GitHub App: give it the `Trayvor/spolu` repository.
   3. Alternatively, run `/web-setup` in the local CLI. It uses your `gh` login.
2. **Create an environment** for the repo, in the environment selector. Set:
   - **Network access:** Trusted. If the setup script cannot download Node or the Playwright browser, switch to Custom and add `nodejs.org` and `playwright.azureedge.net`, or use Full.
   - **Environment variables:** none needed. Tests and e2e use built-in defaults, and `.env` is created from `.env.example`. Never put secrets there: everyone who uses the environment can read them.
   - **Setup script** (runs as root on Ubuntu 24.04 before Claude starts; its result is cached for about 7 days). The image ships Node 22, but the repo requires Node 24 (`engine-strict`):

     ```bash
     #!/bin/bash
     set -e
     npm install -g n && n 24 && hash -r
     corepack enable
     cd "$CLAUDE_PROJECT_DIR" 2>/dev/null || cd /home/user/spolu 2>/dev/null || true
     pnpm install --frozen-lockfile || true
     pnpm exec playwright install --with-deps chromium || true
     docker pull postgres:17 || true
     docker pull axllent/mailpit || true
     ```

     The image names must match `docker-compose.dev.yml`. Keep the script under about 5 minutes, or the cache is not used. Services cannot be started here: they do not survive the snapshot, which is why the hook starts them.
3. **Check it in a first session.** Ask Claude to run `pnpm test` and `bash scripts/ci.sh`. If Docker does not work in the sandbox, the hook logs it. Then install PostgreSQL 17 with `apt` in the setup script, or use the image's PostgreSQL 16 (`service postgresql start`) and point `TEST_DATABASE_URL` and `DATABASE_URL` at it.

## Working rules in the cloud

- Work on a branch and open a pull request. Never push to `main`: every push to `main` deploys to spolu.egrant.sk (`deploy-test.yml`). The `CI` workflow checks every pull request.
- On the pull request, the session can watch CI and fix failures ("Auto-fix" in the CI bar at claude.ai/code).
- Merging the pull request deploys it.
- To continue a cloud session locally: `claude --teleport` in a clean checkout of the repo.

## Optional: `@claude` in issues and pull requests

1. Run `/install-github-app` in the local CLI. It needs `gh auth login` and admin rights on the repo.
2. It installs the app, stores the secret and opens a pull request with `.github/workflows/claude.yml`.
3. For the secret, use either:
   - `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, which uses your subscription;
   - `ANTHROPIC_API_KEY`, which is billed per token.
