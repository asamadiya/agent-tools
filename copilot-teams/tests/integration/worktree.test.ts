import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addWorktree,
  finalizeWorktree,
  generateBranchName,
  isGitRepo,
  removeWorktree,
  worktreeHasChanges,
} from "../../src/worktree.js";

const UUID = "11111111-2222-3333-4444-555555555555";

let repo: string;

beforeEach(async () => {
  repo = mkdtempSync(join(tmpdir(), "ct-repo-"));
  await execa("git", ["init", "-q", "-b", "main"], { cwd: repo });
  await execa("git", ["config", "user.email", "t@t"], { cwd: repo });
  await execa("git", ["config", "user.name", "t"], { cwd: repo });
  writeFileSync(join(repo, "README.md"), "x\n");
  await execa("git", ["add", "."], { cwd: repo });
  await execa("git", ["commit", "-q", "-m", "init"], { cwd: repo });
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("worktree integration", () => {
  it("isGitRepo: true inside repo, false outside", async () => {
    expect(await isGitRepo(repo)).toBe(true);
    const tmp = mkdtempSync(join(tmpdir(), "notrepo-"));
    expect(await isGitRepo(tmp)).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("rejects worktree creation outside a repo", async () => {
    const notrepo = mkdtempSync(join(tmpdir(), "notrepo-"));
    await expect(
      addWorktree(notrepo, generateBranchName("x", UUID)),
    ).rejects.toThrow(/not inside a git repo/);
    rmSync(notrepo, { recursive: true, force: true });
  });

  it("addWorktree creates a usable working dir on a fresh branch", async () => {
    const branch = generateBranchName("foo", UUID);
    const h = await addWorktree(repo, branch);
    expect(existsSync(h.worktree)).toBe(true);
    expect(existsSync(join(h.worktree, "README.md"))).toBe(true);
    expect(h.branch).toBe(branch);
    await removeWorktree(h, { deleteBranch: true });
    expect(existsSync(h.worktree)).toBe(false);
  });

  it("worktreeHasChanges reflects pending writes", async () => {
    const h = await addWorktree(repo, generateBranchName("c", UUID));
    expect(await worktreeHasChanges(h)).toBe(false);
    writeFileSync(join(h.worktree, "new.txt"), "hi\n");
    expect(await worktreeHasChanges(h)).toBe(true);
    await removeWorktree(h, { deleteBranch: true });
  });

  it("finalize: cleans up when no changes", async () => {
    const h = await addWorktree(repo, generateBranchName("clean", UUID));
    const out = await finalizeWorktree(h);
    expect(out.kept).toBe(false);
    expect(existsSync(h.worktree)).toBe(false);
  });

  it("finalize: keeps when changes present", async () => {
    const h = await addWorktree(repo, generateBranchName("dirty", UUID));
    writeFileSync(join(h.worktree, "a.txt"), "a\n");
    const out = await finalizeWorktree(h);
    expect(out.kept).toBe(true);
    expect(existsSync(h.worktree)).toBe(true);
    // Cleanup so afterEach can rm the parent repo
    await removeWorktree(h, { deleteBranch: true });
  });
});
