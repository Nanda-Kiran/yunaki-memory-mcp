import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const memRoot = mkdtempSync(path.join(tmpdir(), "yunaki-ingest-mem-"));
process.env.YUNAKI_MEMORY_ROOT = memRoot;

const repo = process.cwd(); // ingest the Yunaki repo itself
const { ensureRepoMemory } = await import("../dist/repo.js");
const { runIngest } = await import("../dist/ingest.js");
const { listMemories } = await import("../dist/memory.js");

const mem = await ensureRepoMemory(repo);
const r = await runIngest(mem);
console.log("repoId        :", r.repoId);
console.log("files scanned :", r.fileCount);
console.log("stacks        :", r.stacks.join("; "));
console.log("docs          :", r.docs.join(", "));
console.log("entries       :", r.entries.length);

console.log("\nmemory entries now:");
for (const m of listMemories(mem)) console.log(`  [${m.type}] ${m.id}`);

const before = listMemories(mem).length;
const r2 = await runIngest(mem);
console.log(`\nidempotency re-run: count ${before} -> ${listMemories(mem).length}, committed=${r2.committed}`);

console.log("\ngit log:");
console.log(execFileSync("git", ["-C", mem.dir, "log", "--oneline"]).toString().trim());

console.log("\nINGEST SMOKE OK");
