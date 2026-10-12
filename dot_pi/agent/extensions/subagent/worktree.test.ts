import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
	MERGE_STASH_MESSAGE,
	PRESERVED_BRANCH_PREFIX,
	createWorktree,
	mergeAndCleanup,
	sweepOrphanedSubagentArtifacts,
} from "./worktree.ts";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeRepo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-wt-test-"));
	git(dir, "init", "-q", "-b", "main");
	git(dir, "config", "user.email", "t@t");
	git(dir, "config", "user.name", "t");
	git(dir, "config", "commit.gpgsign", "false");
	fs.writeFileSync(path.join(dir, "a.txt"), "base\n");
	fs.writeFileSync(path.join(dir, "b.txt"), "base\n");
	git(dir, "add", ".");
	git(dir, "commit", "-q", "-m", "init");
	return dir;
}

test("preserves the subagent branch when merge fails and the sweep keeps it", async () => {
	const repo = makeRepo();
	const handle = await createWorktree(repo, "builder");
	fs.writeFileSync(path.join(handle.worktreePath, "a.txt"), "child\n");
	git(handle.worktreePath, "commit", "-q", "-am", "child");
	fs.writeFileSync(path.join(repo, "a.txt"), "parent\n");
	git(repo, "commit", "-q", "-am", "parent");

	const res = await mergeAndCleanup(handle, "builder", "t");
	expect(res.merged).toBe(false);
	expect(res.preservedBranch?.startsWith(PRESERVED_BRANCH_PREFIX)).toBe(true);
	expect(res.message.includes(`git merge ${res.preservedBranch}`)).toBe(true);
	expect(fs.existsSync(handle.worktreePath)).toBe(false);
	expect(git(repo, "log", "-1", "--format=%s", res.preservedBranch!)).toBe("child");

	await sweepOrphanedSubagentArtifacts(repo);
	expect(git(repo, "branch", "--list", res.preservedBranch!).includes(res.preservedBranch!)).toBe(true);
	fs.rmSync(repo, { recursive: true, force: true });
});

test("deletes the branch after a successful merge", async () => {
	const repo = makeRepo();
	const handle = await createWorktree(repo, "builder");
	fs.writeFileSync(path.join(handle.worktreePath, "c.txt"), "new\n");
	git(handle.worktreePath, "add", ".");
	git(handle.worktreePath, "commit", "-q", "-m", "child");
	const res = await mergeAndCleanup(handle, "builder", "t");
	expect(res.merged).toBe(true);
	expect(res.preservedBranch).toBeUndefined();
	expect(git(repo, "branch", "--list", handle.branchName)).toBe("");
	fs.rmSync(repo, { recursive: true, force: true });
});

test("never drops the user's stash when stash pop conflicts", async () => {
	const repo = makeRepo();
	const handle = await createWorktree(repo, "builder");
	fs.writeFileSync(path.join(handle.worktreePath, "b.txt"), "child\n");
	git(handle.worktreePath, "commit", "-q", "-am", "child");
	fs.writeFileSync(path.join(repo, "b.txt"), "user edit\n");

	const res = await mergeAndCleanup(handle, "builder", "t");
	expect(res.merged).toBe(true);
	expect(res.message.includes(MERGE_STASH_MESSAGE)).toBe(true);
	expect(git(repo, "stash", "list").includes(MERGE_STASH_MESSAGE)).toBe(true);
	fs.rmSync(repo, { recursive: true, force: true });
});
