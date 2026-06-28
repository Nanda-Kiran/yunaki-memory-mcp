import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

/** Run git in `cwd`, returning trimmed stdout. Throws on non-zero exit. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexec("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

/** Like git(), but returns null instead of throwing — for optional lookups. */
export async function gitSafe(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

/** Stage everything and commit; no-op (returns false) when the tree is clean. */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  await git(dir, ["add", "-A"]);
  const status = await git(dir, ["status", "--porcelain"]);
  if (status.length === 0) return false;
  await git(dir, ["commit", "-q", "-m", message]);
  return true;
}
