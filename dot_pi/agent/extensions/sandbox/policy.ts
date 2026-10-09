import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface SandboxPolicy {
	project: string;
	writable: string[];
	readOnly: string[];
	hidden: string[];
	hiddenDirs: string[];
	network: boolean;
}

export interface SandboxConfig {
	writable: string[];
	hidden: string[];
	hiddenDirs: string[];
	network?: boolean;
}

// Session sockets reachable from inside the sandbox would let a command act
// outside it (systemd-run via D-Bus, ssh-agent, docker, tmux send-keys).
export interface HostPaths {
	runtimeDirs: string[];
	sockets: string[];
	tmp: string;
}

export function hostPaths(): HostPaths {
	return {
		runtimeDirs: [process.env.XDG_RUNTIME_DIR || `/run/user/${os.userInfo().uid}`, "/run/dbus"],
		sockets: ["/run/docker.sock"],
		tmp: "/tmp",
	};
}

const SESSION_ENV = ["SSH_AUTH_SOCK", "DBUS_SESSION_BUS_ADDRESS", "DISPLAY", "WAYLAND_DISPLAY"];

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

function isSocket(p: string): boolean {
	try {
		return fs.lstatSync(p).isSocket();
	} catch {
		return false;
	}
}

function entries(dir: string): string[] {
	try {
		return fs.readdirSync(dir).map((name) => path.join(dir, name));
	} catch {
		return [];
	}
}

// Sockets directly in tmp are masked as files; a directory holding one
// (tmux-<uid>, .X11-unix, ssh-XXXX) is masked whole.
function tmpSockets(tmp: string): { files: string[]; dirs: string[] } {
	const files: string[] = [];
	const dirs: string[] = [];
	for (const entry of entries(tmp)) {
		if (isSocket(entry)) files.push(entry);
		else if (entries(entry).some(isSocket)) dirs.push(entry);
	}
	return { files, dirs };
}

function sshPrivateKeys(home: string): string[] {
	const dir = path.join(home, ".ssh");
	try {
		return fs.readdirSync(dir).filter((f) => f.startsWith("id_") && !f.endsWith(".pub")).map((f) => path.join(dir, f));
	} catch {
		return [];
	}
}

export function secretPaths(config: SandboxConfig, home: string): { hidden: string[]; hiddenDirs: string[] } {
	return { hidden: [...sshPrivateKeys(home), ...existing(config.hidden, home)], hiddenDirs: existing(config.hiddenDirs, home) };
}

export function resolvePolicy(cwd: string, config: SandboxConfig, home: string, host: HostPaths = hostPaths()): SandboxPolicy {
	const git = gitDirs(cwd);
	const project = git?.top ?? fs.realpathSync(cwd);
	const writable = [project];
	const readOnly: string[] = [];
	if (git) {
		if (!isWithin(git.common, [project])) writable.push(git.common);
		// Hooks and config run outside the sandbox the next time the user runs git.
		readOnly.push(...existing([path.join(git.common, "hooks"), path.join(git.common, "config")], home));
	}
	writable.push(host.tmp, ...existing(config.writable, home).filter((p) => !writable.includes(p)));
	const secrets = secretPaths(config, home);
	const sockets = tmpSockets(host.tmp);
	const coversWritable = (dir: string) => writable.some((w) => isWithin(w, [dir]));
	return {
		project,
		writable,
		readOnly,
		hidden: [...secrets.hidden, ...existing(host.sockets, home), ...sockets.files],
		hiddenDirs: [...secrets.hiddenDirs, ...[...existing(host.runtimeDirs, home), ...sockets.dirs].filter((d) => !coversWritable(d))],
		network: config.network !== false,
	};
}

export function homeRootReason(policy: SandboxPolicy, home: string): string | null {
	return isWithin(home, [policy.project])
		? `the project root ${policy.project} contains your home directory, so all of it would be writable; start pi inside a project (/sandbox off to override)`
		: null;
}

export function bwrapArgs(policy: SandboxPolicy, cwd: string): string[] {
	const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"];
	for (const dir of policy.writable) args.push("--bind", dir, dir);
	// Later mounts shadow earlier ones, so carve-outs must follow the writable roots.
	for (const dir of policy.readOnly) args.push("--ro-bind", dir, dir);
	for (const file of policy.hidden) args.push("--ro-bind", "/dev/null", file);
	for (const dir of policy.hiddenDirs) args.push("--tmpfs", dir);
	for (const name of SESSION_ENV) args.push("--unsetenv", name);
	if (!policy.network) args.push("--unshare-net");
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
