import fs from "node:fs";
import path from "node:path";
import { gitSafe, commitAll } from "./git.js";
import { putMemoryFile, updateIndex } from "./memory.js";
import type { RepoMemory } from "./repo.js";

export interface IngestOpts {
  maxDocs?: number;
  maxDocBytes?: number;
  maxDepth?: number;
}

export interface IngestResult {
  repoId: string;
  fileCount: number;
  stacks: string[];
  docs: string[];
  entries: string[];
  committed: boolean;
}

function readJson(file: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Tracked + untracked-but-not-ignored files — i.e. real repo content, no node_modules/build. */
async function listRepoFiles(root: string): Promise<string[]> {
  const out = await gitSafe(root, ["ls-files", "--cached", "--others", "--exclude-standard"]);
  if (!out) return [];
  return [...new Set(out.split("\n").map((s) => s.trim()).filter(Boolean))].sort();
}

function repoName(root: string, files: string[]): string {
  if (files.includes("package.json")) {
    const pkg = readJson(path.join(root, "package.json"));
    if (pkg?.name) return pkg.name as string;
  }
  return path.basename(root);
}

function detectStacks(root: string, files: string[]): string[] {
  const set = new Set(files);
  const has = (...names: string[]) => names.some((n) => set.has(n));
  const out: string[] = [];
  if (set.has("package.json")) {
    out.push(`Node/${set.has("tsconfig.json") ? "TypeScript" : "JavaScript"} (package.json)`);
  }
  if (has("pyproject.toml", "requirements.txt", "setup.py", "Pipfile")) out.push("Python");
  if (set.has("Cargo.toml")) out.push("Rust (Cargo.toml)");
  if (set.has("go.mod")) out.push("Go (go.mod)");
  if (has("pom.xml", "build.gradle", "build.gradle.kts")) out.push("JVM (Maven/Gradle)");
  if (set.has("Gemfile")) out.push("Ruby (Gemfile)");
  if (set.has("composer.json")) out.push("PHP (composer.json)");
  if (has("Dockerfile", "docker-compose.yml", "compose.yaml")) out.push("Docker");
  return out;
}

function topExtensions(files: string[], n: number): { ext: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    const base = path.basename(f);
    const dot = base.lastIndexOf(".");
    const ext = dot > 0 ? base.slice(dot) : "(none)";
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([ext, count]) => ({ ext, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);
}

interface TreeNode {
  files: string[];
  dirs: Map<string, TreeNode>;
}

function countFiles(node: TreeNode): number {
  let n = node.files.length;
  for (const c of node.dirs.values()) n += countFiles(c);
  return n;
}

function buildTree(paths: string[], maxDepth: number): string {
  const root: TreeNode = { files: [], dirs: new Map() };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts[i];
      let next = node.dirs.get(d);
      if (!next) {
        next = { files: [], dirs: new Map() };
        node.dirs.set(d, next);
      }
      node = next;
    }
    node.files.push(parts[parts.length - 1]);
  }

  const lines: string[] = [];
  const FILE_CAP = 40;
  const walk = (node: TreeNode, prefix: string, depth: number) => {
    for (const name of [...node.dirs.keys()].sort()) {
      const child = node.dirs.get(name)!;
      if (depth + 1 >= maxDepth) {
        lines.push(`${prefix}${name}/ — ${countFiles(child)} files`);
      } else {
        lines.push(`${prefix}${name}/`);
        walk(child, prefix + "  ", depth + 1);
      }
    }
    const names = node.files.sort();
    for (const f of names.slice(0, FILE_CAP)) lines.push(`${prefix}${f}`);
    if (names.length > FILE_CAP) lines.push(`${prefix}… ${names.length - FILE_CAP} more files`);
  };
  walk(root, "", 0);
  return lines.join("\n");
}

function selectDocs(files: string[]): string[] {
  const docExt = /\.(md|mdx|rst|txt|adoc)$/i;
  const rootDoc = /^(readme|contributing|architecture|changelog|usage|install|getting[-_ ]?started|design|roadmap|notes)/i;
  const picked = files.filter((f) => {
    const base = path.basename(f);
    if (f.toLowerCase().startsWith("docs/") && docExt.test(base)) return true;
    return rootDoc.test(base);
  });
  const score = (x: string) =>
    /readme/i.test(path.basename(x)) ? 0 : x.toLowerCase().startsWith("docs/") ? 2 : 1;
  return picked.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    return sa !== sb ? sa - sb : a.localeCompare(b);
  });
}

function buildOverview(root: string, files: string[]): string {
  const name = repoName(root, files);
  const stacks = detectStacks(root, files);
  const exts = topExtensions(files, 6);
  const lines = [
    "# Repo overview",
    "",
    `- **Name:** ${name}`,
    `- **Tracked files:** ${files.length}`,
    `- **Stack:** ${stacks.length ? stacks.join("; ") : "unknown"}`,
  ];
  if (exts.length) {
    lines.push(`- **Top file types:** ${exts.map((e) => `${e.ext} (${e.count})`).join(", ")}`);
  }
  const pkg = files.includes("package.json") ? readJson(path.join(root, "package.json")) : null;
  if (pkg) {
    if (pkg.scripts) lines.push(`- **npm scripts:** ${Object.keys(pkg.scripts).join(", ")}`);
    if (pkg.bin) {
      const binKeys = typeof pkg.bin === "string" ? [name] : Object.keys(pkg.bin);
      lines.push(`- **bin:** ${binKeys.join(", ")}`);
    }
    const deps = pkg.dependencies ? Object.keys(pkg.dependencies) : [];
    if (deps.length) lines.push(`- **Key deps:** ${deps.slice(0, 12).join(", ")}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Scan the repo and write reference memories (overview, structure, docs).
 * Idempotent: stable slugs + overwrite, all in one commit.
 */
export async function runIngest(mem: RepoMemory, opts: IngestOpts = {}): Promise<IngestResult> {
  const root = mem.identity.root;
  const maxDocs = opts.maxDocs ?? 20;
  const maxDocBytes = opts.maxDocBytes ?? 4000;
  const maxDepth = opts.maxDepth ?? 3;

  const files = await listRepoFiles(root);
  const entries: string[] = [];

  entries.push(
    putMemoryFile(mem, {
      type: "reference",
      slug: "repo-overview",
      overwrite: true,
      source: "ingest",
      tags: ["repo", "overview"],
      content: buildOverview(root, files),
    }).relPath
  );

  entries.push(
    putMemoryFile(mem, {
      type: "reference",
      slug: "repo-structure",
      overwrite: true,
      source: "ingest",
      tags: ["repo", "structure"],
      content: "# File structure\n\n```\n" + buildTree(files, maxDepth) + "\n```\n",
    }).relPath
  );

  const docs: string[] = [];
  for (const rel of selectDocs(files).slice(0, maxDocs)) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    const body =
      `# ${rel}\n\n` +
      (text.length > maxDocBytes ? text.slice(0, maxDocBytes) + "\n\n…[truncated]" : text);
    entries.push(
      putMemoryFile(mem, {
        type: "reference",
        slug: "doc-" + rel.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase(),
        overwrite: true,
        source: "ingest",
        tags: ["repo", "doc"],
        content: body,
      }).relPath
    );
    docs.push(rel);
  }

  updateIndex(mem);
  const committed = await commitAll(mem.dir, `ingest: ${mem.identity.id} (${entries.length} entries)`);

  return {
    repoId: mem.identity.id,
    fileCount: files.length,
    stacks: detectStacks(root, files),
    docs,
    entries,
    committed,
  };
}
