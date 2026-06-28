import os from "node:os";
import path from "node:path";

/** Central, per-user store. Each repo gets its own git-backed subdir keyed by identity. */
export const MEM_ROOT =
  process.env.YUNAKI_MEMORY_ROOT ?? path.join(os.homedir(), ".yunaki", "memory");

/** Repo the server resolves against when a tool call omits repoPath. */
export const DEFAULT_CWD = process.env.YUNAKI_REPO ?? process.cwd();

export type MemoryType =
  | "fact"
  | "heuristic"
  | "failure"
  | "success"
  | "preference"
  | "reference";

export const MEMORY_TYPES: MemoryType[] = [
  "fact",
  "heuristic",
  "failure",
  "success",
  "preference",
  "reference",
];
