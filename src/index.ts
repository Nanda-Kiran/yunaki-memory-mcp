#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ensureRepoMemory } from "./repo.js";
import { writeMemory, searchMemory, listMemories } from "./memory.js";
import { runIngest } from "./ingest.js";
import { DEFAULT_CWD, MEMORY_TYPES } from "./config.js";

const typeEnum = z.enum(MEMORY_TYPES as [string, ...string[]]);

const server = new McpServer({ name: "yunaki-memory", version: "0.1.0" });

server.registerTool(
  "memory_write",
  {
    title: "Write memory",
    description:
      "Persist a memory for the current git repo. Auto-creates the repo's git-backed memory store on first use and commits the write.",
    inputSchema: {
      content: z.string().describe("The memory body (markdown)."),
      type: typeEnum.optional().describe("fact | heuristic | failure | success | preference | reference"),
      tags: z.array(z.string()).optional(),
      title: z.string().optional().describe("Short title used for the filename/slug."),
      source: z.string().optional().describe("Provenance, e.g. a run id."),
      repoPath: z
        .string()
        .optional()
        .describe("A path inside the target repo. Defaults to the server's cwd."),
    },
  },
  async (args) => {
    const mem = await ensureRepoMemory(args.repoPath ?? DEFAULT_CWD);
    const res = await writeMemory(mem, args as any);
    return {
      content: [
        { type: "text", text: `Wrote ${res.type}/${res.id} to repo ${mem.identity.id}\n${res.relPath}` },
      ],
    };
  }
);

server.registerTool(
  "memory_search",
  {
    title: "Search memory",
    description:
      "Retrieve relevant memories for the current git repo, ranked by keyword match blended with confidence. Empty query returns the highest-confidence memories.",
    inputSchema: {
      query: z.string().describe("What to look for. Pass an empty string for top memories."),
      type: typeEnum.optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().int().positive().max(50).optional(),
      repoPath: z.string().optional(),
    },
  },
  async (args) => {
    const mem = await ensureRepoMemory(args.repoPath ?? DEFAULT_CWD);
    const results = searchMemory(mem, args.query, args as any);
    if (results.length === 0) {
      return { content: [{ type: "text", text: `No memories for repo ${mem.identity.id} yet.` }] };
    }
    const text = results
      .map((r) => {
        const tags = r.tags.length ? " " + r.tags.map((t) => "#" + t).join(" ") : "";
        return `### ${r.id}  \`${r.type}\` (conf ${r.confidence})${tags}\n${r.body}`;
      })
      .join("\n\n");
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "memory_ingest",
  {
    title: "Ingest repo content",
    description:
      "Scan the current git repo (tracked + non-ignored files) and write reference memories: a repo overview (stack, npm scripts, file types), the file-structure tree, and the contents of docs (README, CONTRIBUTING, docs/*). Idempotent — re-running updates the same entries in a single commit. Run this once when adopting a repo to seed memory.",
    inputSchema: {
      repoPath: z.string().optional().describe("A path inside the target repo. Defaults to the server's cwd."),
      maxDocs: z.number().int().positive().max(200).optional().describe("Max doc files to capture (default 20)."),
      maxDocBytes: z.number().int().positive().max(50000).optional().describe("Max bytes per doc (default 4000)."),
      maxDepth: z.number().int().positive().max(8).optional().describe("File-tree depth before collapsing (default 3)."),
    },
  },
  async (args) => {
    const mem = await ensureRepoMemory(args.repoPath ?? DEFAULT_CWD);
    const r = await runIngest(mem, args as any);
    const text =
      `Ingested repo ${r.repoId}\n` +
      `- files scanned : ${r.fileCount}\n` +
      `- stack         : ${r.stacks.join("; ") || "unknown"}\n` +
      `- docs captured : ${r.docs.length ? r.docs.join(", ") : "(none)"}\n` +
      `- entries written: ${r.entries.length}\n` +
      `- committed     : ${r.committed}`;
    return { content: [{ type: "text", text }] };
  }
);

server.registerTool(
  "memory_repo_info",
  {
    title: "Repo memory info",
    description: "Show the resolved identity and memory location for the current git repo.",
    inputSchema: { repoPath: z.string().optional() },
  },
  async (args) => {
    const mem = await ensureRepoMemory(args.repoPath ?? DEFAULT_CWD);
    const count = listMemories(mem).length;
    const i = mem.identity;
    return {
      content: [
        {
          type: "text",
          text:
            `repo id : ${i.id}\n` +
            `remote  : ${i.remote || "(none)"}\n` +
            `root    : ${i.root}\n` +
            `memory  : ${mem.dir}\n` +
            `entries : ${count}`,
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("yunaki-memory MCP server running on stdio");
