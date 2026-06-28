# Yunaki Memory MCP

A git-backed, **per-repo** memory layer exposed as an MCP server — the substrate for a
self-evolving Claude skill. Drop the skill into any git repo and a dedicated, version-controlled
memory store materializes on first write. Every memory is a commit, so the skill's growth is a
readable, revertible history.

## How it works

- **Identity, not path.** Memory is keyed to a repo's *root-commit SHA* (`git rev-list
  --max-parents=0 HEAD`), which survives clone / rename / remote-move. Commit-less repos fall
  back to a UUID cached in `.git/config`. Path and remote URL are kept only as labels.
- **Central sidecar.** Stores live at `~/.yunaki/memory/<repo-id>/` (override with
  `YUNAKI_MEMORY_ROOT`) — never pollutes the user's repo, needs no write access to it.
- **Ad hoc creation.** `ensureRepoMemory(cwd)` runs at the top of every tool call: it resolves
  identity, and on first touch `git init`s the store, seeds `repo.json` + `MEMORY.md`, and commits.
  Idempotent thereafter.
- **One file per memory.** Markdown + YAML frontmatter under `<type>/<slug>.md` — clean diffs,
  trivial merges. `MEMORY.md` is the rebuilt index (the cheap working set).

## Tools

| Tool | Purpose |
|---|---|
| `memory_write` | Persist a memory (fact/heuristic/failure/success/preference) — commits it |
| `memory_search` | Retrieve memories for the current repo, ranked by keyword × confidence |
| `memory_repo_info` | Show resolved identity + memory location for the current repo |

All accept an optional `repoPath`; otherwise they resolve against the server's cwd.

## Build & test

```bash
npm install
npm run build
npm run smoke   # end-to-end against a throwaway repo
```

## Register with Claude Code

```bash
claude mcp add yunaki-memory -- node /Users/nandu/Documents/Yunaki/Yunaki-hackathon/dist/index.js
```

or in `.mcp.json`:

```json
{
  "mcpServers": {
    "yunaki-memory": {
      "command": "node",
      "args": ["/Users/nandu/Documents/Yunaki/Yunaki-hackathon/dist/index.js"]
    }
  }
}
```

## Roadmap (the "self-evolving" half)

1. `memory_reinforce(id, outcome)` — bump/decay `confidence` + `usage_count` instead of duplicating.
2. Dedup-before-write — semantic/slug match so reinforcement replaces near-duplicates.
3. `memory_consolidate()` — merge dupes, prune stale, and **promote** high-confidence memories into
   the skill's `SKILL.md`. That promotion (a git diff of the skill rewriting itself) is the payoff.
4. Embedding rerank (Voyage) cached in the gitignored `.index/`.
5. `memory_publish(id)` — opt-in copy of vetted memories into `<repo>/.claude/memory/` for team sharing.
