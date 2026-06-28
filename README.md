# Yunaki Memory MCP

A git-backed, **per-repo** memory layer exposed as an MCP server — the substrate for a
self-evolving Claude skill. Drop the skill into any git repo and a dedicated, version-controlled
memory store materializes on first write. Every memory is a commit, so the skill's growth is a
readable, revertible history.

## Install & use

The server is stdio-based: **each person runs their own copy locally**, against their own repos.
Pick whichever install fits — none requires editing an absolute path.

**npx from GitHub** (no npm publish needed; works once the repo is public):

```bash
claude mcp add yunaki-memory -- npx -y github:Nanda-Kiran/yunaki-memory-mcp
```

**npx from npm** (after `npm publish`):

```bash
claude mcp add yunaki-memory -- npx -y yunaki-memory-mcp
```

**Clone & build** (zero publishing):

```bash
git clone https://github.com/Nanda-Kiran/yunaki-memory-mcp.git
cd yunaki-memory-mcp && npm install && npm run build
claude mcp add yunaki-memory -- node "$(pwd)/dist/index.js"
```

Equivalent `.mcp.json` (commit this in any repo to share the config with collaborators):

```json
{
  "mcpServers": {
    "yunaki-memory": {
      "command": "npx",
      "args": ["-y", "github:Nanda-Kiran/yunaki-memory-mcp"]
    }
  }
}
```

> Memory is stored **per-user** under `~/.yunaki/memory/<repo-id>/` (override with
> `YUNAKI_MEMORY_ROOT`). Installing the server does not share memories between people — see
> *Roadmap* for `memory_sync`, which turns each store into a pushable/pullable team memory.

## How it works

- **Identity, not path.** Memory is keyed to a repo's *root-commit SHA* (`git rev-list
  --max-parents=0 HEAD`), which survives clone / rename / remote-move. Commit-less repos fall
  back to a UUID cached in `.git/config`. Path and remote URL are kept only as labels.
- **Central sidecar.** Stores live at `~/.yunaki/memory/<repo-id>/` — never pollutes the user's
  repo, needs no write access to it.
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

## Develop

```bash
npm install
npm run build
npm run smoke   # end-to-end against a throwaway repo
```

## Roadmap (the "self-evolving" half)

1. `memory_reinforce(id, outcome)` — bump/decay `confidence` + `usage_count` instead of duplicating.
2. Dedup-before-write — semantic/slug match so reinforcement replaces near-duplicates.
3. `memory_consolidate()` — merge dupes, prune stale, and **promote** high-confidence memories into
   the skill's `SKILL.md`. That promotion (a git diff of the skill rewriting itself) is the payoff.
4. Embedding rerank (Voyage) cached in the gitignored `.index/`.
5. `memory_sync()` — push/pull each repo-memory git store to a remote for shared team memory.

## License

MIT
