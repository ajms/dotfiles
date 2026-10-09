import * as fs from "node:fs";
import * as path from "node:path";
import type { SandboxState } from "./hook.ts";
import { dangerousCommand, homeRootReason, isWithin, resolvePolicy, secretPaths } from "./policy.ts";

const FILE_TOOLS = new Set(["write", "edit"]);

// Resolve symlinks through the deepest existing ancestor, so a new file under
// a symlinked directory is judged by where it would really land.
function realTarget(target: string): string {
	let dir = target;
	const rest: string[] = [];
	while (!fs.existsSync(dir)) {
		rest.unshift(path.basename(dir));
		const parent = path.dirname(dir);
		if (parent === dir) return target;
		dir = parent;
	}
	return path.join(fs.realpathSync(dir), ...rest);
}

export function guardToolCall(
	toolName: string,
	input: Record<string, unknown>,
	cwd: string,
	state: SandboxState,
): { block: true; reason: string } | undefined {
	if (!state.enabled) return undefined;
	if (toolName === "bash" && typeof input.command === "string") {
		const reason = dangerousCommand(input.command);
		return reason ? { block: true, reason: `Blocked by sandbox: this command ${reason}.` } : undefined;
	}
	if (typeof input.path !== "string") return undefined;
	const raw = input.path.startsWith("~") ? path.join(state.home, input.path.slice(1)) : input.path;
	const target = realTarget(path.resolve(cwd, raw));
	const secrets = secretPaths(state.config, state.home);
	if (secrets.hidden.map(realTarget).includes(target) || isWithin(target, secrets.hiddenDirs.map(realTarget))) {
		return { block: true, reason: `Blocked by sandbox: ${target} is a hidden secret.` };
	}
	if (FILE_TOOLS.has(toolName)) {
		const policy = resolvePolicy(cwd, state.config, state.home);
		const refusal = homeRootReason(policy, state.home);
		if (refusal) return { block: true, reason: `Blocked by sandbox: ${refusal}.` };
		if (!isWithin(target, policy.writable) || isWithin(target, policy.readOnly)) {
			return { block: true, reason: `Blocked by sandbox: ${target} is outside the writable project roots.` };
		}
	}
	return undefined;
}
