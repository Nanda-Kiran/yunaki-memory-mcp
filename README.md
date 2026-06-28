# Yunaki Memory MCP

A git-backed, **per-repo** memory layer exposed as an MCP server — the substrate for a
self-evolving Claude skill. Drop the skill into any git repo and a dedicated, version-controlled
memory store materializes on first write. Every memory is a commit, so the skill's growth is a
readable, revertible history.

## Install & use

The server is stdio-based: **each person runs their own copy locally**, against their own repos.
Pick whichever install fits — none requires editing an absolute path.

**npx from GitHub** (no npm publish needed):

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
> *Roadmap* for `memory_sync`.

## Quick start

When you first adopt a repo, run **`memory_ingest`** once to seed memory with the repo's overview,
file structure, and docs. After that the skill accumulates memories as it works.

## How it works

- **Identity, not path.** Memory is keyed to a repo's *root-commit SHA* (`git rev-list
  --max-parents=0 HEAD`), which survives clone / rename / remote-move. Commit-less repos fall
  back to a UUID cached in `.git/config`. Path and remote URL are kept only as labels.
- **Repo discovery.** The server resolves the active repo from its working directory (the Claude
  Code CLI launches it inside your project), overridable per call via `repoPath` or pinned with the
  `YUNAKI_REPO` env var.
- **Central sidecar.** Stores live at `~/.yunaki/memory/<repo-id>/` — never pollutes the user's repo.
- **Ad hoc creation.** `ensureRepoMemory(cwd)` runs at the top of every tool call: resolves
  identity, and on first touch `git init`s the store, seeds `repo.json` + `MEMORY.md`, and commits.
- **One file per memory.** Markdown + YAML frontmatter under `<type>/<slug>.md` — clean diffs,
  trivial merges. `MEMORY.md` is the rebuilt index (the cheap working set).

## Tools

| Tool | Purpose |
|---|---|
| `memory_ingest` | Scan the repo and seed `reference` memories: overview (stack, scripts, file types), file tree, and docs. Idempotent. |
| `memory_write` | Persist a memory (fact/heuristic/failure/success/preference/reference) — commits it |
| `memory_search` | Retrieve memories for the current repo, ranked by keyword × confidence |
| `memory_repo_info` | Show resolved identity + memory location for the current repo |

All accept an optional `repoPath`; otherwise they resolve against the server's cwd.

## Develop

```bash
npm install
npm run build
npm run smoke           # core write/search loop
node test/ingest-smoke.mjs   # ingest against this repo
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
