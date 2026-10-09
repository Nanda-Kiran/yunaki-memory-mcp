# Yunaki Memory MCP

Git-backed, per-repo memory for coding agents, exposed as an MCP server.

Each git repo the server is used in gets its own memory store. The store is a separate git repository under `~/.yunaki/memory/<repo-id>/`. Every `memory_write` is a commit, and each `memory_ingest` run is one commit. What an agent records about a repo becomes plain-text history you can read, diff and revert. Memories are never written into your project's files. The one thing the server writes inside your repo is an id in `.git/config`, and only for a repo that has no commits yet.

## How it works

- **Stable repo identity.** A repo is keyed by its root-commit SHA (`git rev-list --max-parents=0 HEAD`, first 12 chars). On your machine, its memory stays with it after a re-clone, a rename or a remote change. A shallow clone (`git clone --depth ...`) reports a different root commit, so it gets a separate store. A repo with no commits gets a UUID cached in its `.git/config` (`yunaki.memoryId`). After its first commit, the repo is keyed by its root commit, and the UUID store is not carried over.
- **Created on first use.** Every tool call resolves the repo first. If the path is not inside a git repository, the call returns an error. On first touch the server `git init`s the store, seeds `repo.json` and `MEMORY.md`, and commits.
- **One file per memory.** Each memory is a Markdown file with YAML frontmatter at `<type>/<slug>.md`, so every change is a small, separate diff. `MEMORY.md` is rebuilt as an index on every write.
- **Seed from the repo.** `memory_ingest` writes `reference` memories built from the repo's file list, its `package.json` and its docs. A new store then starts with an overview of the repo rather than empty.

```
~/.yunaki/memory/<repo-id>/      # its own git repo (root overridable with YUNAKI_MEMORY_ROOT)
├── repo.json                    # root commit, remote, last seen path, createdAt
├── MEMORY.md                    # index, sorted by confidence
├── heuristic/use-pnpm-in-this-repo-not-npm-lockfile-is-pnpm-lock-yaml.md
└── reference/
    ├── repo-overview.md
    ├── repo-structure.md
    └── doc-readme-md.md
```

A memory file:

```markdown
---
id: use-pnpm-in-this-repo-not-npm-lockfile-is-pnpm-lock-yaml
type: heuristic
tags:
  - tooling
  - package-manager
confidence: 0.5
usage_count: 0
last_used: '2026-06-28'
status: active
source: ''
created: '2026-06-28'
updated: '2026-06-28'
---
Use pnpm in this repo, not npm — lockfile is pnpm-lock.yaml.
```

## Tools

| Tool | What it does |
|---|---|
| `memory_write` | Saves a memory of type `fact` (default), `heuristic`, `failure`, `success`, `preference` or `reference`, with optional tags, title and source. The title, or the content's first line if there is no title, becomes the filename. If that file already exists, a short suffix is added so nothing is overwritten. Rebuilds the index and commits. |
| `memory_search` | Scores each memory by how many query terms appear in its id, tags and body, adds its confidence, and returns the top `limit` (default 8, max 50). There is no score cutoff, so memories with no keyword hits can fill the remaining slots. You can filter by type and by tags; a memory must carry every tag you pass. Memories whose `status` is `deprecated` are skipped. An empty query returns the top memories by confidence. |
| `memory_ingest` | Lists tracked files plus untracked files that are not gitignored, then writes three kinds of `reference` memory. The first is a repo overview: name, file count, stack detected from marker files such as `package.json`, `pyproject.toml`, `Cargo.toml` or `go.mod`, top file types, npm scripts, bin entries and the first 12 dependencies. The second is a file tree, collapsed below `maxDepth` (default 3). The third is the text of doc files: `.md`, `.mdx`, `.rst`, `.txt` and `.adoc` files under `docs/`, plus any file whose name starts with README, CONTRIBUTING, ARCHITECTURE, CHANGELOG, USAGE, INSTALL, GETTING-STARTED, DESIGN, ROADMAP or NOTES. It captures up to `maxDocs` docs (default 20) and keeps the first `maxDocBytes` of each (default 4,000). Slugs are stable and the whole run is one commit, so re-running updates the same entries. |
| `memory_repo_info` | Shows the resolved repo id, remote, root, memory directory and entry count. |

Every tool takes an optional `repoPath`, which can be any path inside the target repo. Without it, the server uses `YUNAKI_REPO` if that is set, and otherwise its own working directory (Claude Code starts it inside your project).

## Install

Requires Node 18+ and `git` on your PATH. The server speaks MCP over stdio, so each person runs a local copy against their own repos.

From GitHub with npx (the `prepare` script compiles the TypeScript on install):

```bash
claude mcp add yunaki-memory -- npx -y github:Nanda-Kiran/yunaki-memory-mcp
```

Or clone and build:

```bash
git clone https://github.com/Nanda-Kiran/yunaki-memory-mcp.git
cd yunaki-memory-mcp && npm install && npm run build
claude mcp add yunaki-memory -- node "$(pwd)/dist/index.js"
```

Or commit a `.mcp.json` to share the config with collaborators:

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

Memory is stored per user. Installing the server does not share memories between people.

When you adopt a repo, run `memory_ingest` once to seed it.

## Develop

```bash
npm install
npm run build
npm run smoke                 # temp repo: two writes, a search, the store's git log, a re-open
node test/ingest-smoke.mjs    # run from the repo root: ingests it twice, prints the entry count before and after
```

Both scripts point `YUNAKI_MEMORY_ROOT` at a temp directory, so they leave `~/.yunaki` alone. They print their results without asserting on them, so they fail only if a call throws.

| File | Role |
|---|---|
| `src/index.ts` | MCP server and tool schemas (zod) |
| `src/repo.ts` | Repo identity and lazy store creation |
| `src/memory.ts` | Memory files, index, search |
| `src/ingest.ts` | Repo scan, stack detection, file tree, doc capture |
| `src/git.ts` | git calls via `execFile` |
| `src/config.ts` | Store root, default repo, memory types |

Stack: TypeScript, Node.js, `@modelcontextprotocol/sdk`, `zod`, `gray-matter`, git.

## Status

v0.1.0, early. The per-repo store and the four tools are implemented and exercised by the two smoke scripts above. There are no assertion-based tests and no CI yet. The package is not published to npm. `confidence` and `usage_count` are stored, but nothing updates them yet. Every new memory is written at 0.5, so search ranking currently comes down to keyword hits.

Known gaps:

- Ingest matches doc names by prefix anywhere in the tree, so a file such as `scripts/install.sh` is captured as a doc.
- Ingest does not remove entries for docs that were deleted or renamed.
- No tool sets `status: deprecated` yet. Search honors it only if you edit a memory file by hand.
- A shallow clone gets its own store (see How it works).

## Roadmap (not built yet)

1. `memory_reinforce(id, outcome)`: raise or decay `confidence` and `usage_count` instead of writing duplicates.
2. Dedup before write: match near-duplicates by slug or meaning so reinforcement replaces them.
3. `memory_consolidate()`: merge duplicates, prune stale entries, and promote high-confidence memories into a Claude skill's `SKILL.md`, so the skill's improvements show up as a git diff.
4. Embedding rerank, cached in an `.index/` directory kept out of each store's git history.
5. `memory_sync()`: push and pull each store to a remote for shared team memory.

## License

MIT
