// Shared sandbox state and the bash spawn hook. bash-output owns the bash
// tool registration and plugs this hook in; the sandbox extension mutates the
// state (config, /sandbox on|off).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { BashSpawnContext } from "@earendil-works/pi-coding-agent";
import { bwrapArgs, homeRootReason, resolvePolicy, shellQuote, wrapCommand, type SandboxConfig } from "./policy.ts";

export interface SandboxState {
	enabled: boolean;
	config: SandboxConfig;
	home: string;
	bwrapPath: string;
}

export const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "sandbox.json");

export function loadConfig(file = CONFIG_PATH): SandboxConfig {
	const empty: SandboxConfig = { writable: [], hidden: [], hiddenDirs: [] };
	try {
		const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SandboxConfig> & { enabled?: boolean };
		return { ...empty, ...raw };
	} catch {
		return empty;
	}
}

function configEnabled(file = CONFIG_PATH): boolean {
	try {
		return (JSON.parse(fs.readFileSync(file, "utf8")) as { enabled?: boolean }).enabled !== false;
	} catch {
		return true;
	}
}

export const sandboxState: SandboxState = {
	enabled: os.platform() === "linux" && configEnabled(),
	config: loadConfig(),
	home: os.homedir(),
	bwrapPath: "/usr/bin/bwrap",
};

export function createSpawnHook(getState: () => SandboxState) {
	return (ctx: BashSpawnContext): BashSpawnContext => {
		const state = getState();
		if (!state.enabled) return ctx;
		if (!fs.existsSync(state.bwrapPath)) {
			const message = `sandbox: ${state.bwrapPath} not found; refusing to run unsandboxed (/sandbox off to override)`;
			return { ...ctx, command: `echo ${shellQuote(message)} >&2; exit 126` };
		}
		const policy = resolvePolicy(ctx.cwd, state.config, state.home);
		const refusal = homeRootReason(policy, state.home);
		if (refusal) return { ...ctx, command: `echo ${shellQuote(`sandbox: ${refusal}`)} >&2; exit 126` };
		return { ...ctx, command: wrapCommand(ctx.command, bwrapArgs(policy, ctx.cwd), state.bwrapPath) };
	};
}

export const sandboxSpawnHook = createSpawnHook(() => sandboxState);
