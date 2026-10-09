import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { createSpawnHook, type SandboxState } from "./hook.ts";

const config = { writable: [], hidden: [], hiddenDirs: [] };

function state(overrides: Partial<SandboxState> = {}): SandboxState {
	return { enabled: true, config, home: os.tmpdir(), bwrapPath: "/usr/bin/bwrap", ...overrides };
}

test("enabled sandbox wraps the command in bwrap rooted at the call's cwd", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-hook-"));
	const out = createSpawnHook(() => state())({ command: "ls", cwd, env: {} });
	assert.ok(out.command.startsWith("exec '/usr/bin/bwrap' "));
	assert.ok(out.command.includes(`'--chdir' '${fs.realpathSync(cwd)}'`) || out.command.includes(`'--chdir' '${cwd}'`));
	assert.equal(out.cwd, cwd);
});

test("disabled sandbox leaves the command alone", () => {
	const ctx = { command: "ls", cwd: "/", env: {} };
	assert.deepEqual(createSpawnHook(() => state({ enabled: false }))(ctx), ctx);
});

test("missing bwrap fails closed instead of running unsandboxed", () => {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-hook-"));
	const out = createSpawnHook(() => state({ bwrapPath: path.join(cwd, "no-bwrap") }))({ command: "touch ran", cwd, env: {} });
	let status = 0;
	try {
		execFileSync("/bin/bash", ["-c", out.command], { cwd, stdio: "ignore" });
	} catch (error) {
		status = (error as { status: number }).status;
	}
	assert.equal(status, 126);
	assert.ok(!fs.existsSync(path.join(cwd, "ran")));
});

test("running from the home directory is refused instead of making all of home writable", () => {
	const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-hook-home-")));
	const out = createSpawnHook(() => state({ home }))({ command: "touch ran", cwd: home, env: {} });
	let status = 0;
	let stderr = "";
	try {
		execFileSync("/bin/bash", ["-c", out.command], { cwd: home, stdio: ["ignore", "ignore", "pipe"] });
	} catch (error) {
		status = (error as { status: number }).status;
		stderr = String((error as { stderr: Buffer }).stderr);
	}
	assert.equal(status, 126);
	assert.match(stderr, /home directory/);
	assert.ok(!fs.existsSync(path.join(home, "ran")));
});
