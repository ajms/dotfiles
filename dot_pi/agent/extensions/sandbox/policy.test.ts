import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import * as net from "node:net";
import { bwrapArgs, dangerousCommand, isWithin, resolvePolicy, wrapCommand, type HostPaths, type SandboxPolicy } from "./policy.ts";

// Isolate test git from the user's global config (e.g. commit.gpgsign).
Object.assign(process.env, {
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_COUNT: "3",
	GIT_CONFIG_KEY_0: "commit.gpgsign",
	GIT_CONFIG_VALUE_0: "false",
	GIT_CONFIG_KEY_1: "user.name",
	GIT_CONFIG_VALUE_1: "Test",
	GIT_CONFIG_KEY_2: "user.email",
	GIT_CONFIG_VALUE_2: "test@example.com",
});

const NO_HOST: HostPaths = { runtimeDirs: [], sockets: [], tmp: fs.mkdtempSync(path.join(os.tmpdir(), "pi-empty-tmp-")) };

function policy(overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
	return { project: "/work/repo", writable: ["/work/repo", "/tmp"], readOnly: [], hidden: [], hiddenDirs: [], network: true, ...overrides };
}

test("bwrap mounts the host read-only and only the writable roots read-write", () => {
	const args = bwrapArgs(policy(), "/work/repo/src");
	assert.deepEqual(args.slice(0, 3), ["--ro-bind", "/", "/"]);
	assert.ok(args.join(" ").includes("--bind /work/repo /work/repo"));
	assert.ok(args.join(" ").includes("--bind /tmp /tmp"));
	assert.deepEqual(args.slice(-2), ["--chdir", "/work/repo/src"]);
	for (const flag of ["--die-with-parent", "--new-session", "--unshare-pid"]) assert.ok(args.includes(flag), flag);
	assert.ok(!args.includes("--unshare-net"));
});

test("read-only carve-outs and hidden paths are mounted after the writable roots", () => {
	const args = bwrapArgs(policy({ readOnly: ["/work/repo/.git/hooks"], hidden: ["/home/u/.ssh/id_ed25519"] }), "/work/repo").join(" ");
	assert.ok(args.indexOf("--bind /work/repo /work/repo") < args.indexOf("--ro-bind /work/repo/.git/hooks /work/repo/.git/hooks"));
	assert.ok(args.includes("--ro-bind /dev/null /home/u/.ssh/id_ed25519"));
});

test("wrapped command survives quotes and runs the original through bash", () => {
	const wrapped = wrapCommand(`echo "it's" 'fine'`, ["--ro-bind", "/", "/"]);
	assert.ok(wrapped.startsWith("exec bwrap "));
	assert.ok(wrapped.endsWith(`-- /bin/bash -c 'echo "it'\\''s" '\\''fine'\\'''`));
});

test("destructive commands are flagged, ordinary ones pass", () => {
	for (const cmd of ["rm -rf /", "rm -rf ~", "rm -rf $HOME", "sudo rm -rf /*", "mkfs.ext4 /dev/sda1", "dd if=x of=/dev/nvme0n1", "chmod -R 777 .", "git clean -fdx"]) {
		assert.ok(dangerousCommand(cmd), cmd);
	}
	for (const cmd of ["rm -rf node_modules", "git add .", "rm -rf ./build", "echo harm done", "git clean -fd", "dd if=a of=b"]) {
		assert.equal(dangerousCommand(cmd), null, cmd);
	}
});

test("containment check resolves paths and refuses prefix look-alikes", () => {
	assert.equal(isWithin("/work/repo/src/a.ts", ["/work/repo"]), true);
	assert.equal(isWithin("/work/repo", ["/work/repo"]), true);
	assert.equal(isWithin("/work/repo-other/a.ts", ["/work/repo"]), false);
	assert.equal(isWithin("/work/repo/../etc/passwd", ["/work/repo"]), false);
});

test("a real sandboxed command can write the project but not outside it", { skip: !fs.existsSync("/usr/bin/bwrap") }, () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sandbox-"));
	const project = path.join(root, "project");
	const outside = path.join(root, "outside");
	fs.mkdirSync(project);
	fs.mkdirSync(outside);
	const wrapped = wrapCommand(
		`touch inside.txt && (touch ${outside}/x.txt 2>/dev/null && echo escaped || echo blocked)`,
		bwrapArgs({ project, writable: [project], readOnly: [], hidden: [], hiddenDirs: [], network: true }, project),
	);
	const out = execFileSync("/bin/bash", ["-c", wrapped], { encoding: "utf8" }).trim();
	assert.equal(out, "blocked");
	assert.ok(fs.existsSync(path.join(project, "inside.txt")));
	assert.ok(!fs.existsSync(path.join(outside, "x.txt")));
});

test("hidden directories are replaced by an empty tmpfs", () => {
	const args = bwrapArgs(policy({ hiddenDirs: ["/home/u/.gnupg"] }), "/work/repo").join(" ");
	assert.ok(args.includes("--tmpfs /home/u/.gnupg"));
});

test("policy for a git worktree: project and shared git dir writable, hooks/config read-only, secrets hidden", () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-policy-"));
	const home = path.join(root, "home");
	const main = path.join(root, "main");
	const wt = path.join(root, "wt");
	fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
	fs.mkdirSync(path.join(home, ".gnupg"));
	fs.mkdirSync(path.join(home, ".cache"));
	fs.writeFileSync(path.join(home, ".ssh", "id_ed25519"), "k");
	fs.writeFileSync(path.join(home, ".ssh", "id_ed25519.pub"), "k");
	fs.writeFileSync(path.join(home, ".ssh", "known_hosts"), "h");
	fs.mkdirSync(main);
	const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" });
	git(main, "init", "-q");
	git(main, "-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i");
	git(main, "worktree", "add", "-q", wt);

	const p = resolvePolicy(path.join(wt), { writable: ["~/.cache", "~/.missing"], hidden: ["~/.pi/agent/auth.json"], hiddenDirs: ["~/.gnupg"] }, home, NO_HOST);

	const mainGit = fs.realpathSync(path.join(main, ".git"));
	assert.ok(p.writable.includes(fs.realpathSync(wt)));
	assert.ok(p.writable.includes(mainGit));
	assert.ok(p.writable.includes(NO_HOST.tmp));
	assert.ok(p.writable.includes(path.join(home, ".cache")));
	assert.ok(!p.writable.includes(path.join(home, ".missing")));
	assert.ok(p.readOnly.includes(path.join(mainGit, "hooks")));
	assert.ok(p.readOnly.includes(path.join(mainGit, "config")));
	assert.deepEqual(p.hidden, [path.join(home, ".ssh", "id_ed25519")]);
	assert.deepEqual(p.hiddenDirs, [path.join(home, ".gnupg")]);
});

test("policy outside git makes only the working directory the project root", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-policy-nogit-"));
	const p = resolvePolicy(dir, { writable: [], hidden: [], hiddenDirs: [] }, dir, NO_HOST);
	assert.deepEqual(p.writable, [fs.realpathSync(dir), NO_HOST.tmp]);
	assert.deepEqual(p.readOnly, []);
});

test("session sockets are cut off: agent env vars unset, network kept unless disabled", () => {
	const args = bwrapArgs(policy(), "/work/repo").join(" ");
	for (const name of ["SSH_AUTH_SOCK", "DBUS_SESSION_BUS_ADDRESS", "DISPLAY"]) assert.ok(args.includes(`--unsetenv ${name}`), name);
	assert.ok(!args.includes("--unshare-net"));
	assert.ok(bwrapArgs(policy({ network: false }), "/work/repo").includes("--unshare-net"));
});

test("network can be turned off in the config", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-policy-net-"));
	assert.equal(resolvePolicy(dir, { writable: [], hidden: [], hiddenDirs: [] }, dir, NO_HOST).network, true);
	assert.equal(resolvePolicy(dir, { writable: [], hidden: [], hiddenDirs: [], network: false }, dir, NO_HOST).network, false);
});

async function listen(socketPath: string): Promise<net.Server> {
	const server = net.createServer().listen(socketPath);
	await new Promise((resolve) => server.once("listening", resolve));
	return server;
}

test("policy masks the runtime dir, system sockets and sockets in tmp", async () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-sock-")));
	const tmp = path.join(root, "tmp");
	const runtime = path.join(root, "run-user");
	const docker = path.join(root, "docker.sock");
	fs.mkdirSync(path.join(tmp, "tmux-1"), { recursive: true });
	fs.mkdirSync(path.join(tmp, "plain"));
	fs.mkdirSync(runtime);
	fs.writeFileSync(docker, "");
	const servers = [await listen(path.join(tmp, "top.sock")), await listen(path.join(tmp, "tmux-1", "default"))];
	try {
		const host: HostPaths = { runtimeDirs: [runtime, path.join(root, "missing")], sockets: [docker], tmp };
		const p = resolvePolicy(root, { writable: [], hidden: [], hiddenDirs: [] }, root, host);
		assert.ok(p.writable.includes(tmp));
		assert.ok(!p.writable.includes("/tmp"));
		assert.deepEqual(p.hiddenDirs.sort(), [runtime, path.join(tmp, "tmux-1")].sort());
		assert.deepEqual(p.hidden.sort(), [docker, path.join(tmp, "top.sock")].sort());
	} finally {
		for (const s of servers) s.close();
	}
});

test("a socket dir that contains the project is not masked over it", async () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-sock-proj-")));
	const tmp = path.join(root, "tmp");
	const project = path.join(tmp, "work");
	fs.mkdirSync(project, { recursive: true });
	const server = await listen(path.join(tmp, "work", "agent.sock"));
	try {
		const p = resolvePolicy(project, { writable: [], hidden: [], hiddenDirs: [] }, root, { runtimeDirs: [], sockets: [], tmp });
		assert.ok(!p.hiddenDirs.includes(project));
	} finally {
		server.close();
	}
});

test("a real sandboxed command cannot see masked sockets or the runtime dir", { skip: !fs.existsSync("/usr/bin/bwrap") }, async () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-sock-real-")));
	const tmp = path.join(root, "tmp");
	const runtime = path.join(root, "run-user");
	fs.mkdirSync(tmp);
	fs.mkdirSync(runtime);
	fs.writeFileSync(path.join(runtime, "bus"), "");
	const sock = path.join(tmp, "top.sock");
	const server = await listen(sock);
	try {
		const p = resolvePolicy(root, { writable: [], hidden: [], hiddenDirs: [] }, os.homedir(), { runtimeDirs: [runtime], sockets: [], tmp });
		const script = `test -S ${sock} && echo sock; ls -A ${runtime}; echo done`;
		const out = execFileSync("/bin/bash", ["-c", wrapCommand(script, bwrapArgs(p, root))], { encoding: "utf8" }).trim();
		assert.equal(out, "done");
	} finally {
		server.close();
	}
});
