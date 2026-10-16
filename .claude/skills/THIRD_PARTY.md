# Third-party skills

These skills are copied into the repo so that Claude Code cloud sessions (claude.ai/code), which do not load plugins, have them too. The project disables the two plugins in `.claude/settings.json`, so local and cloud sessions use the same copies.

| skills | source | version | license |
|---|---|---|---|
| brainstorming, dispatching-parallel-agents, executing-plans, finishing-a-development-branch, receiving-code-review, requesting-code-review, subagent-driven-development, systematic-debugging, test-driven-development, using-git-worktrees, using-superpowers, verification-before-completion, writing-plans, writing-skills | the `superpowers` plugin by Jesse Vincent | 6.4.2 | MIT (`LICENSE` in each folder) |
| frontend-design | Anthropic's `frontend-design` plugin (claude-plugins-official) | ea10b213686c | Apache 2.0 (`frontend-design/LICENSE.txt`) |

Local changes: plugin-prefixed names (`superpowers:<name>`, `frontend-design:frontend-design`) were renamed to the bare skill names. Otherwise the files are unchanged. To update, copy a newer plugin version over these folders and rename the prefixes again.

Prettier and ESLint skip `.claude/skills` because it holds vendored code.
