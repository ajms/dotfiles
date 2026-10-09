import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface SandboxPolicy {
	writable: string[];
	readOnly: string[];
	hidden: string[];
	hiddenDirs: string[];
}

export interface SandboxConfig {
	writable: string[];
	hidden: string[];
	hiddenDirs: string[];
}

function expandHome(p: string, home: string): string {
	return p === "~" || p.startsWith("~/") ? path.join(home, p.slice(1)) : p;
}

function existing(paths: string[], home: string): string[] {
	return paths.map((p) => expandHome(p, home)).filter((p) => fs.existsSync(p));
}

function gitDirs(cwd: string): { top: string; common: string } | null {
	try {
		const [top, common] = execFileSync("git", ["rev-parse", "--show-toplevel", "--git-common-dir"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim().split("\n");
		return { top: fs.realpathSync(top), common: fs.realpathSync(path.resolve(cwd, common)) };
	} catch {
		return null;
	}
}

function sshPrivateKeys(home: string): string[] {
	const dir = path.join(home, ".ssh");
	try {
		return fs.readdirSync(dir).filter((f) => f.startsWith("id_") && !f.endsWith(".pub")).map((f) => path.join(dir, f));
	} catch {
		return [];
	}
}

export function resolvePolicy(cwd: string, config: SandboxConfig, home: string): SandboxPolicy {
	const git = gitDirs(cwd);
	const project = git?.top ?? fs.realpathSync(cwd);
	const writable = [project];
	const readOnly: string[] = [];
	if (git) {
		if (!isWithin(git.common, [project])) writable.push(git.common);
		// Hooks and config run outside the sandbox the next time the user runs git.
		readOnly.push(...existing([path.join(git.common, "hooks"), path.join(git.common, "config")], home));
	}
	writable.push("/tmp", ...existing(config.writable, home).filter((p) => !writable.includes(p)));
	return {
		writable,
		readOnly,
		hidden: [...sshPrivateKeys(home), ...existing(config.hidden, home)],
		hiddenDirs: existing(config.hiddenDirs, home),
	};
}

export function bwrapArgs(policy: SandboxPolicy, cwd: string): string[] {
	const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"];
	for (const dir of policy.writable) args.push("--bind", dir, dir);
	// Later mounts shadow earlier ones, so carve-outs must follow the writable roots.
	for (const dir of policy.readOnly) args.push("--ro-bind", dir, dir);
	for (const file of policy.hidden) args.push("--ro-bind", "/dev/null", file);
	for (const dir of policy.hiddenDirs) args.push("--tmpfs", dir);
	args.push("--die-with-parent", "--new-session", "--unshare-pid", "--chdir", cwd);
	return args;
}

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function wrapCommand(command: string, args: string[], bwrap = "bwrap"): string {
	const binary = bwrap === "bwrap" ? bwrap : shellQuote(bwrap);
	return `exec ${binary} ${args.map(shellQuote).join(" ")} -- /bin/bash -c ${shellQuote(command)}`;
}

const ROOT_TARGET = /\s(?:\/|\/\*|~\/?|\$HOME\/?|\$\{HOME\}\/?)(?=\s|$)/;

const RULES: Array<[RegExp, string]> = [
	[/\bmkfs(?:\.\w+)?\b/, "formats a filesystem"],
	[/\bdd\b.*\bof=\/dev\//, "writes a raw block device"],
	[/\bchmod\s+-R\s+777\b/, "makes a tree world-writable"],
	[/\bgit\s+clean\b.*\s-[a-zA-Z]*x/, "deletes ignored files, which checkpoints do not cover"],
];

export function dangerousCommand(command: string): string | null {
	for (const segment of command.split(/[;&|\n]+/)) {
		if (/\brm\b/.test(segment) && /\s-[a-zA-Z]*[rR]/.test(segment) && ROOT_TARGET.test(segment)) {
			return "recursively deletes the root or home directory";
		}
		for (const [pattern, reason] of RULES) if (pattern.test(segment)) return reason;
	}
	return null;
}

export function isWithin(target: string, roots: string[]): boolean {
	const resolved = path.resolve(target);
	return roots.some((root) => {
		const relative = path.relative(path.resolve(root), resolved);
		return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
	});
}
