// Project checkpoints as commits under refs/pi-checkpoints/*, built with a
// throwaway index so HEAD, the real index and the stash are never touched.
// Ignored files are not captured.
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const PREFIX = "refs/pi-checkpoints/";
const IDENTITY = {
	GIT_AUTHOR_NAME: "pi",
	GIT_AUTHOR_EMAIL: "pi@localhost",
	GIT_COMMITTER_NAME: "pi",
	GIT_COMMITTER_EMAIL: "pi@localhost",
};

export interface Checkpoint {
	name: string;
	label: string;
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
	const { stdout } = await run("git", args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
	return stdout.trim();
}

async function toplevel(dir: string): Promise<string | null> {
	try {
		return await git(dir, ["rev-parse", "--show-toplevel"]);
	} catch {
		return null;
	}
}

async function withScratchIndex<T>(fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-checkpoint-index-"));
	try {
		return await fn({ GIT_INDEX_FILE: path.join(tmp, "index") });
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

async function snapshotTree(top: string): Promise<{ tree: string; head: string | null }> {
	const head = await git(top, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => null);
	const tree = await withScratchIndex(async (env) => {
		if (head) await git(top, ["read-tree", head], env);
		await git(top, ["add", "-A"], env);
		return git(top, ["write-tree"], env);
	});
	return { tree, head };
}

async function nextRefName(top: string): Promise<string> {
	for (let stamp = Date.now(); ; stamp++) {
		const name = `${PREFIX}${stamp}`;
		const exists = await git(top, ["rev-parse", "--verify", "-q", name]).then(() => true, () => false);
		if (!exists) return name;
	}
}

export async function listCheckpoints(dir: string): Promise<Checkpoint[]> {
	const top = await toplevel(dir);
	if (!top) return [];
	const out = await git(top, ["for-each-ref", "--sort=-refname", "--format=%(refname)%09%(subject)", PREFIX]);
	return out
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [name, label = ""] = line.split("\t");
			return { name, label };
		});
}

export async function createCheckpoint(dir: string, label: string): Promise<string | null> {
	const top = await toplevel(dir);
	if (!top) return null;
	const { tree, head } = await snapshotTree(top);
	const [latest] = await listCheckpoints(top);
	if (latest && (await git(top, ["rev-parse", `${latest.name}^{tree}`])) === tree) return latest.name;
	const parents = head ? ["-p", head] : [];
	const commit = await git(top, ["commit-tree", "--no-gpg-sign", tree, ...parents, "-m", label], IDENTITY);
	const name = await nextRefName(top);
	await git(top, ["update-ref", name, commit]);
	return name;
}

export async function rollback(dir: string, name: string): Promise<string> {
	const top = await toplevel(dir);
	if (!top) throw new Error("not a git repository");
	await git(top, ["rev-parse", "--verify", "-q", `${name}^{commit}`]);
	const saved = await createCheckpoint(top, `before rollback to ${name}`);
	if (!saved) throw new Error("could not save the current state before rolling back");
	const added = await git(top, ["diff", "--name-only", "--diff-filter=A", "-z", name, saved]);
	for (const file of added.split("\0").filter(Boolean)) fs.rmSync(path.join(top, file), { force: true });
	await withScratchIndex(async (env) => {
		await git(top, ["read-tree", name], env);
		await git(top, ["checkout-index", "-a", "-f"], env);
	});
	return saved;
}

export async function pruneCheckpoints(dir: string, keep: number): Promise<void> {
	const top = await toplevel(dir);
	if (!top) return;
	for (const { name } of (await listCheckpoints(top)).slice(keep)) await git(top, ["update-ref", "-d", name]);
}
