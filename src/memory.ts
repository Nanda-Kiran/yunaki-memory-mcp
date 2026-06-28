import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { commitAll } from "./git.js";
import type { RepoMemory } from "./repo.js";
import type { MemoryType } from "./config.js";

export interface WriteArgs {
  content: string;
  type?: MemoryType;
  tags?: string[];
  title?: string;
  source?: string;
}

/** Lower-level write: explicit slug + optional overwrite, no index/commit (caller batches those). */
export interface PutArgs {
  content: string;
  type: string;
  tags?: string[];
  source?: string;
  slug?: string;
  overwrite?: boolean;
}

export interface MemoryRecord {
  id: string;
  type: string;
  tags: string[];
  confidence: number;
  status: string;
  body: string;
  relPath: string;
  absPath: string;
  updated: string;
}

export interface SearchOpts {
  type?: MemoryType;
  tags?: string[];
  limit?: number;
}

export interface WriteResult {
  id: string;
  type: string;
  relPath: string;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "memory"
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Walk every memory file in the repo-memory and parse frontmatter. */
export function listMemories(mem: RepoMemory): MemoryRecord[] {
  const out: MemoryRecord[] = [];
  for (const entry of fs.readdirSync(mem.dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".git") continue;
    const typeDir = path.join(mem.dir, entry.name);
    for (const f of fs.readdirSync(typeDir)) {
      if (!f.endsWith(".md")) continue;
      const abs = path.join(typeDir, f);
      const parsed = matter(fs.readFileSync(abs, "utf8"));
      const d = parsed.data as Record<string, unknown>;
      out.push({
        id: (d.id as string) ?? f.replace(/\.md$/, ""),
        type: (d.type as string) ?? entry.name,
        tags: (d.tags as string[]) ?? [],
        confidence: typeof d.confidence === "number" ? d.confidence : 0.5,
        status: (d.status as string) ?? "active",
        body: parsed.content.trim(),
        relPath: path.relative(mem.dir, abs),
        absPath: abs,
        updated: (d.updated as string) ?? "",
      });
    }
  }
  return out;
}

/** Rebuild MEMORY.md — the cheap "working set" index loaded each session. */
export function updateIndex(mem: RepoMemory): void {
  const records = listMemories(mem).sort((a, b) => b.confidence - a.confidence);
  const header = `# Memory — ${mem.identity.remote || mem.identity.root}\n\n${records.length} memories.\n\n`;
  const lines = records.map((r) => {
    const tags = r.tags.length ? " " + r.tags.map((t) => "#" + t).join(" ") : "";
    return `- [${r.id}](${r.relPath}) \`${r.type}\`${tags} — conf ${r.confidence}`;
  });
  fs.writeFileSync(
    path.join(mem.dir, "MEMORY.md"),
    header + lines.join("\n") + (lines.length ? "\n" : "")
  );
}

/** Write a single memory file. Does not touch the index or commit. */
export function putMemoryFile(mem: RepoMemory, args: PutArgs): WriteResult {
  const type = args.type;
  const typeDir = path.join(mem.dir, type);
  fs.mkdirSync(typeDir, { recursive: true });

  let slug = slugify(args.slug ?? args.content.split("\n")[0]);
  let file = path.join(typeDir, `${slug}.md`);

  let created = today();
  let usage = 0;
  let confidence = 0.5;

  if (fs.existsSync(file)) {
    if (args.overwrite) {
      try {
        const prev = matter(fs.readFileSync(file, "utf8")).data as Record<string, unknown>;
        if (typeof prev.created === "string") created = prev.created;
        if (typeof prev.usage_count === "number") usage = prev.usage_count;
        if (typeof prev.confidence === "number") confidence = prev.confidence;
      } catch {
        /* fall through with defaults */
      }
    } else {
      slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
      file = path.join(typeDir, `${slug}.md`);
    }
  }

  const now = today();
  const frontmatter = {
    id: slug,
    type,
    tags: args.tags ?? [],
    confidence,
    usage_count: usage,
    last_used: now,
    status: "active",
    source: args.source ?? "",
    created,
    updated: now,
  };

  fs.writeFileSync(file, matter.stringify(args.content.trim() + "\n", frontmatter));
  return { id: slug, type, relPath: path.relative(mem.dir, file) };
}

/** Create a memory, refresh the index, and commit — the high-level single-write path. */
export async function writeMemory(mem: RepoMemory, args: WriteArgs): Promise<WriteResult> {
  const res = putMemoryFile(mem, {
    content: args.content,
    type: (args.type ?? "fact") as string,
    tags: args.tags,
    source: args.source,
    slug: args.title,
  });
  updateIndex(mem);
  await commitAll(mem.dir, `memory: add ${res.type}/${res.id}`);
  return res;
}

/** Keyword score blended with confidence. Embedding rerank is a later upgrade. */
export function searchMemory(mem: RepoMemory, query: string, opts: SearchOpts = {}): MemoryRecord[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let records = listMemories(mem).filter((r) => r.status !== "deprecated");

  if (opts.type) records = records.filter((r) => r.type === opts.type);
  if (opts.tags?.length) records = records.filter((r) => opts.tags!.every((t) => r.tags.includes(t)));

  const scored = records.map((r) => {
    const hay = `${r.id} ${r.tags.join(" ")} ${r.body}`.toLowerCase();
    let hits = 0;
    for (const t of terms) if (hay.includes(t)) hits += 1;
    return { r, score: hits + r.confidence };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.limit ?? 8).map((s) => s.r);
}
