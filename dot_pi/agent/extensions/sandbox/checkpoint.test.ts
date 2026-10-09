import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { createCheckpoint, listCheckpoints, pruneCheckpoints, rollback } from "./checkpoint.ts";

function git(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repo(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-checkpoint-"));
	git(dir, "init", "-q");
	git(dir, "config", "user.email", "t@example.com");
	git(dir, "config", "user.name", "t");
	fs.writeFileSync(path.join(dir, ".gitignore"), "ignored/\n");
	fs.writeFileSync(path.join(dir, "tracked.txt"), "v1\n");
	git(dir, "add", ".");
	git(dir, "commit", "-qm", "init");
	return dir;
}

test("a checkpoint captures tracked edits and untracked files without touching index or HEAD", async () => {
	const dir = repo();
	fs.writeFileSync(path.join(dir, "tracked.txt"), "v2\n");
	fs.writeFileSync(path.join(dir, "new.txt"), "new\n");
	const head = git(dir, "rev-parse", "HEAD");
	const status = git(dir, "status", "--porcelain");

	const name = await createCheckpoint(dir, "before run");

	assert.ok(name);
	assert.equal(git(dir, "rev-parse", "HEAD"), head);
	assert.equal(git(dir, "status", "--porcelain"), status);
	assert.equal(git(dir, "show", `${name}:tracked.txt`), "v2");
	assert.equal(git(dir, "show", `${name}:new.txt`), "new");
	assert.deepEqual((await listCheckpoints(dir)).map((c) => c.name), [name]);
});

test("an unchanged tree does not produce a duplicate checkpoint", async () => {
	const dir = repo();
	const first = await createCheckpoint(dir, "a");
	const second = await createCheckpoint(dir, "b");
	assert.ok(first);
	assert.equal(second, first);
	assert.equal((await listCheckpoints(dir)).length, 1);
});

test("rollback restores content, deletes files created since, keeps ignored files, and saves the pre-rollback state", async () => {
	const dir = repo();
	const name = await createCheckpoint(dir, "before run");
	assert.ok(name);
	fs.writeFileSync(path.join(dir, "tracked.txt"), "broken\n");
	fs.writeFileSync(path.join(dir, "junk.txt"), "junk\n");
	fs.mkdirSync(path.join(dir, "ignored"));
	fs.writeFileSync(path.join(dir, "ignored", "cache"), "keep\n");

	const saved = await rollback(dir, name);

	assert.equal(fs.readFileSync(path.join(dir, "tracked.txt"), "utf8"), "v1\n");
	assert.ok(!fs.existsSync(path.join(dir, "junk.txt")));
	assert.ok(fs.existsSync(path.join(dir, "ignored", "cache")));
	assert.equal(git(dir, "show", `${saved}:junk.txt`), "junk");
});

test("pruning keeps only the newest checkpoints", async () => {
	const dir = repo();
	const names: string[] = [];
	for (let i = 0; i < 4; i++) {
		fs.writeFileSync(path.join(dir, "tracked.txt"), `v${i + 10}\n`);
		const name = await createCheckpoint(dir, `run ${i}`);
		assert.ok(name);
		names.push(name);
	}
	await pruneCheckpoints(dir, 2);
	assert.deepEqual((await listCheckpoints(dir)).map((c) => c.name), [names[3], names[2]]);
});

test("outside a git repository no checkpoint is made", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-checkpoint-nogit-"));
	assert.equal(await createCheckpoint(dir, "x"), null);
});
