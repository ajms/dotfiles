/**
 * Linux replacement for vm-isolation.
 *
 *   • Every agent `bash` call runs inside bubblewrap: the host is read-only;
 *     the project (git toplevel or cwd), its shared git dir, /tmp and the
 *     paths in ~/.pi/agent/sandbox.json are writable. Git hooks/config stay
 *     read-only and SSH private keys plus configured secrets are masked, as
 *     are session sockets (runtime dir, D-Bus, docker, sockets in /tmp).
 *     A project root containing $HOME is refused. `"network": false` in
 *     sandbox.json cuts network access.
 *     The hook itself lives in hook.ts and is plugged in by bash-output.
 *   • `write`/`edit` calls outside those roots, any tool reading a masked
 *     secret and a short list of destructive commands are blocked at `tool_call`.
 *   • Before each orchestrator run the project is checkpointed to
 *     refs/pi-checkpoints/* (tracked + untracked, not ignored files).
 *
 * `!` commands typed by the user are not sandboxed.
 *
 * /sandbox [status|on|off|checkpoint|checkpoints|rollback <ref>]
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createCheckpoint, listCheckpoints, pruneCheckpoints, rollback } from "./checkpoint.ts";
import { guardToolCall } from "./guard.ts";
import { CONFIG_PATH, loadConfig, sandboxState } from "./hook.ts";
import { resolvePolicy } from "./policy.ts";

const KEEP_CHECKPOINTS = 20;
const STATUS_KEY = "sandbox";

function setStatus(ctx: ExtensionContext): void {
	if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, sandboxState.enabled ? "🔒" : undefined);
}

function describe(cwd: string): string {
	if (!sandboxState.enabled) return "Sandbox: off — bash runs unsandboxed (`/sandbox on` to re-enable).";
	const policy = resolvePolicy(cwd, sandboxState.config, sandboxState.home);
	return [
		"Sandbox: on",
		`  writable: ${policy.writable.join(", ")}`,
		`  read-only: ${policy.readOnly.join(", ") || "(none)"}`,
		`  masked: ${[...policy.hidden, ...policy.hiddenDirs].join(", ") || "(none)"}`,
		`  network: ${policy.network ? "on" : "off"}`,
		`  config: ${CONFIG_PATH}`,
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	const isSubagent = process.env.PI_SUBAGENT_CHILD === "1";

	pi.on("session_start", async (_event, ctx) => {
		sandboxState.config = loadConfig();
		setStatus(ctx);
	});

	pi.on("tool_call", async (event, ctx) => {
		return guardToolCall(event.toolName, event.input as Record<string, unknown>, ctx.cwd, sandboxState);
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (isSubagent || !sandboxState.enabled) return;
		const cwd = ctx.cwd;
		void createCheckpoint(cwd, `before run ${new Date().toISOString()}`)
			.then((name) => (name ? pruneCheckpoints(cwd, KEEP_CHECKPOINTS) : undefined))
			.catch((error) => {
				if (ctx.hasUI) ctx.ui.notify(`Checkpoint failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			});
	});

	pi.registerCommand("sandbox", {
		description: "Sandbox and checkpoints: status | on | off | checkpoint | checkpoints | rollback <ref>",
		async handler(args, ctx) {
			const [sub = "status", ref] = args.trim().split(/\s+/).filter(Boolean);
			const say = (content: string) => pi.sendMessage({ customType: "sandbox", content, display: true });
			try {
				switch (sub) {
					case "status":
						say(describe(ctx.cwd));
						break;
					case "on":
					case "off":
						sandboxState.enabled = sub === "on";
						setStatus(ctx);
						say(describe(ctx.cwd));
						break;
					case "checkpoint": {
						const name = await createCheckpoint(ctx.cwd, `manual ${new Date().toISOString()}`);
						say(name ? `Checkpoint: ${name}` : "Not a git repository; no checkpoint taken.");
						break;
					}
					case "checkpoints": {
						const all = await listCheckpoints(ctx.cwd);
						say(all.length ? all.map((c) => `${c.name}  ${c.label}`).join("\n") : "No checkpoints.");
						break;
					}
					case "rollback": {
						if (!ref) {
							say("Usage: /sandbox rollback <ref>  (see /sandbox checkpoints)");
							break;
						}
						const saved = await rollback(ctx.cwd, ref);
						say(`Rolled back to ${ref}. The state before rollback is saved as ${saved}.`);
						break;
					}
					default:
						say("Usage: /sandbox [status|on|off|checkpoint|checkpoints|rollback <ref>]");
				}
			} catch (error) {
				say(`sandbox: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
	});
}
