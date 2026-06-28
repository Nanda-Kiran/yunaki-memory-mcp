import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoDir = mkdtempSync(path.join(tmpdir(), "yunaki-repo-"));
const memRoot = mkdtempSync(path.join(tmpdir(), "yunaki-mem-"));

// Throwaway target repo with one commit so a root-commit identity exists.
const g = (args, cwd = repoDir) => execFileSync("git", args, { cwd }).toString().trim();
g(["init", "-q"]);
g(["config", "user.name", "Test"]);
g(["config", "user.email", "test@example.com"]);
writeFileSync(path.join(repoDir, "README.md"), "# demo\n");
g(["add", "-A"]);
g(["commit", "-q", "-m", "initial"]);

// Point the memory store at a temp dir BEFORE importing config.js (it reads env at load).
process.env.YUNAKI_MEMORY_ROOT = memRoot;

const { ensureRepoMemory } = await import("../dist/repo.js");
const { writeMemory, searchMemory } = await import("../dist/memory.js");

const mem = await ensureRepoMemory(repoDir);
console.log("resolved repo id :", mem.identity.id);
console.log("memory dir       :", mem.dir);

await writeMemory(mem, {
  content: "Use pnpm in this repo, not npm — lockfile is pnpm-lock.yaml.",
  type: "heuristic",
  tags: ["tooling", "package-manager"],
});
await writeMemory(mem, {
  content: "Running the full test suite without --runInBand flakes on CI.",
  type: "failure",
  tags: ["testing", "ci"],
});

const hits = searchMemory(mem, "pnpm package manager");
console.log("\nsearch 'pnpm package manager':");
for (const h of hits) {
  console.log(`  [${h.type}] ${h.id} (conf ${h.confidence}) :: ${h.body.slice(0, 60)}`);
}

console.log("\nmemory git log:");
console.log(execFileSync("git", ["-C", mem.dir, "log", "--oneline"]).toString().trim());

console.log("\nidempotency re-open (same id):", (await ensureRepoMemory(repoDir)).identity.id);
console.log("\nSMOKE OK");
