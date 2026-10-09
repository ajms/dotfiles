import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { guardToolCall } from "./guard.ts";
import type { SandboxState } from "./hook.ts";

function setup() {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-guard-")));
	const project = path.join(root, "project");
	fs.mkdirSync(project);
	execFileSync("git", ["init", "-q"], { cwd: project });
	const state: SandboxState = { enabled: true, config: { writable: [], hidden: [], hiddenDirs: [] }, home: root, bwrapPath: "/usr/bin/bwrap" };
	return { root, project, state };
}

test("destructive bash commands are blocked with the reason", () => {
	const { project, state } = setup();
	const result = guardToolCall("bash", { command: "rm -rf ~" }, project, state);
	assert.equal(result?.block, true);
	assert.match(result?.reason ?? "", /home directory/);
	assert.equal(guardToolCall("bash", { command: "rm -rf build" }, project, state), undefined);
});

test("write and edit stay inside the project", () => {
	const { project, state } = setup();
	state.home = "/nonexistent-home";
	assert.equal(guardToolCall("write", { path: "src/a.ts" }, project, state), undefined);
	assert.equal(guardToolCall("edit", { path: path.join(project, "b.ts") }, project, state), undefined);
	assert.equal(guardToolCall("write", { path: "/etc/elsewhere.conf" }, project, state)?.block, true);
	assert.equal(guardToolCall("edit", { path: "~/.zshrc" }, project, state)?.block, true);
});

test("write and edit cannot touch git hooks or config", () => {
	const { project, state } = setup();
	assert.equal(guardToolCall("write", { path: ".git/hooks/pre-commit" }, project, state)?.block, true);
	assert.equal(guardToolCall("edit", { path: ".git/config" }, project, state)?.block, true);
});

test("nothing is guarded while the sandbox is off", () => {
	const { root, project, state } = setup();
	state.enabled = false;
	assert.equal(guardToolCall("bash", { command: "rm -rf /" }, project, state), undefined);
	assert.equal(guardToolCall("write", { path: path.join(root, "x") }, project, state), undefined);
});
