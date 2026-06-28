import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { git, gitSafe, commitAll } from "./git.js";
import { MEM_ROOT } from "./config.js";

export interface RepoIdentity {
  id: string;
  root: string;
  remote: string;
  rootCommit: string;
}

export interface RepoMemory {
  dir: string;
  identity: RepoIdentity;
}

function normalizeRemote(url: string): string {
  if (!url) return "";
  return url
    .replace(/^git@([^:]+):/, "$1/")
    .replace(/^ssh:\/\/git@/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

function writeJson(file: string, data: unknown): void {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Resolve a stable identity for the repo containing `cwd`.
 * Priority: root-commit SHA (survives clone/rename/remote-move) > minted UUID for
 * commit-less repos. Remote URL is carried as a human-readable label.
 */
export async function resolveRepoId(cwd: string): Promise<RepoIdentity> {
  const root = await gitSafe(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error(`Not inside a git repository: ${cwd}`);

  const rootsRaw = await gitSafe(root, ["rev-list", "--max-parents=0", "HEAD"]);
  const rootCommit = rootsRaw ? rootsRaw.split("\n")[0].trim() : "";

  const remote = normalizeRemote((await gitSafe(root, ["remote", "get-url", "origin"])) ?? "");

  let id: string;
  if (rootCommit) {
    id = rootCommit.slice(0, 12);
  } else {
    // No commits yet: mint + cache a uuid in .git/config so it stays stable for this clone.
    let cached = await gitSafe(root, ["config", "--local", "yunaki.memoryId"]);
    if (!cached) {
      cached = randomUUID();
      await git(root, ["config", "--local", "yunaki.memoryId", cached]);
    }
    id = "uuid-" + cached.slice(0, 8);
  }
  return { id, root, remote, rootCommit };
}

/** Lazily create (or open) the git-backed memory store for the repo at `cwd`. Idempotent. */
export async function ensureRepoMemory(cwd: string): Promise<RepoMemory> {
  const identity = await resolveRepoId(cwd);
  const dir = path.join(MEM_ROOT, identity.id);

  if (!fs.existsSync(path.join(dir, ".git"))) {
    fs.mkdirSync(dir, { recursive: true });
    await git(dir, ["init", "-q"]);
    await git(dir, ["config", "user.name", "Yunaki Skill"]);
    await git(dir, ["config", "user.email", "skill@yunaki.local"]);
    writeJson(path.join(dir, "repo.json"), {
      rootCommit: identity.rootCommit,
      remote: identity.remote,
      lastPath: identity.root,
      createdAt: new Date().toISOString(),
    });
    fs.writeFileSync(
      path.join(dir, "MEMORY.md"),
      `# Memory — ${identity.remote || identity.root}\n\n0 memories.\n`
    );
    await commitAll(dir, `init: memory for ${identity.remote || identity.id}`);
  } else {
    // Keep the human-readable breadcrumb fresh if the repo moved on disk.
    const rp = path.join(dir, "repo.json");
    try {
      const meta = JSON.parse(fs.readFileSync(rp, "utf8"));
      if (meta.lastPath !== identity.root) {
        meta.lastPath = identity.root;
        writeJson(rp, meta);
      }
    } catch {
      /* ignore a malformed breadcrumb */
    }
  }
  return { dir, identity };
}
