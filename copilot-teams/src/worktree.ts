import { execa } from "execa";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "./logger.js";

const git = async (
  cwd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const r = await execa("git", args, { cwd, reject: false });
  return {
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
    exitCode: r.exitCode ?? 1,
  };
};

export const isGitRepo = async (cwd: string): Promise<boolean> => {
  const r = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return r.exitCode === 0 && r.stdout.trim() === "true";
};

const SAFE_BRANCH_RE = /[^A-Za-z0-9._/-]+/g;

export const generateBranchName = (
  prefix: string,
  uuid: string,
): string => {
  const cleanPrefix = prefix.trim().replace(SAFE_BRANCH_RE, "-").replace(/^-+|-+$/g, "") || "agent";
  const shortId = uuid.replace(/-/g, "").slice(0, 8);
  return `copilot-teams/${cleanPrefix}-${shortId}`;
};

export interface WorktreeHandle {
  worktree: string;
  branch: string;
  repoRoot: string;
}

export const addWorktree = async (
  repoCwd: string,
  branch: string,
): Promise<WorktreeHandle> => {
  if (!(await isGitRepo(repoCwd))) {
    throw new Error(`worktree: ${repoCwd} is not inside a git repo`);
  }
  const root = (await git(repoCwd, ["rev-parse", "--show-toplevel"])).stdout.trim();
  const worktree = mkdtempSync(join(tmpdir(), "ct-wt-"));
  const r = await git(root, ["worktree", "add", "-b", branch, worktree]);
  if (r.exitCode !== 0) {
    throw new Error(`git worktree add failed: ${r.stderr || r.stdout}`);
  }
  logger.info({ event: "worktree.add", repoRoot: root, worktree, branch }, "worktree created");
  return { worktree, branch, repoRoot: root };
};

export const worktreeHasChanges = async (
  handle: WorktreeHandle,
): Promise<boolean> => {
  const r = await git(handle.worktree, ["status", "--porcelain"]);
  if (r.exitCode !== 0) {
    throw new Error(`git status failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim().length > 0;
};

export const removeWorktree = async (
  handle: WorktreeHandle,
  opts: { deleteBranch?: boolean } = {},
): Promise<void> => {
  const r = await git(handle.repoRoot, ["worktree", "remove", "--force", handle.worktree]);
  if (r.exitCode !== 0) {
    throw new Error(`git worktree remove failed: ${r.stderr || r.stdout}`);
  }
  if (opts.deleteBranch) {
    await git(handle.repoRoot, ["branch", "-D", handle.branch]);
  }
  logger.info({ event: "worktree.remove", ...handle, deletedBranch: opts.deleteBranch }, "worktree removed");
};

export const finalizeWorktree = async (
  handle: WorktreeHandle,
): Promise<{ kept: boolean; handle: WorktreeHandle }> => {
  const changed = await worktreeHasChanges(handle);
  if (!changed) {
    await removeWorktree(handle, { deleteBranch: true });
    return { kept: false, handle };
  }
  return { kept: true, handle };
};
