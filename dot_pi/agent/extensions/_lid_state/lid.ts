/**
 * Shared library for detecting laptop lid state.
 *
 * Exported functions:
 *   - `isLidClosed()`: returns `true` if the lid is closed (clamshell mode)
 *   - `getLidState()`: returns `"closed"` | `"open"` | `"unknown"`
 *
 * macOS reads the AppleClamshellState property via `ioreg`; Linux reads the
 * ACPI button file under /proc/acpi/button/lid. Other platforms return
 * `false`/`"unknown"`.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const IS_MACOS = os.platform() === "darwin";
const IS_LINUX = os.platform() === "linux";
const LINUX_LID_DIR = "/proc/acpi/button/lid";

type LidState = "closed" | "open" | "unknown";

export function parseLinuxLidState(text: string): LidState {
	const match = /state:\s*(open|closed)/.exec(text);
	return match ? (match[1] as LidState) : "unknown";
}

function linuxLidState(): LidState {
	try {
		for (const entry of fs.readdirSync(LINUX_LID_DIR)) {
			const state = parseLinuxLidState(fs.readFileSync(path.join(LINUX_LID_DIR, entry, "state"), "utf8"));
			if (state !== "unknown") return state;
		}
	} catch {
		// No ACPI lid (desktop, container) → unknown.
	}
	return "unknown";
}

function macLidState(): LidState {
	try {
		const output = execSync(
			"ioreg -r -l -k AppleClamshellState 2>/dev/null",
			{ encoding: "utf8", maxBuffer: 10 * 1024 }
		);
		if (/AppleClamshellState.*=\s*Yes/i.test(output)) return "closed";
		if (/AppleClamshellState.*=\s*No/i.test(output)) return "open";
		return "unknown";
	} catch {
		return "unknown";
	}
}

/**
 * Check if the laptop lid is closed.
 * @returns `true` if the lid is closed, `false` if open or unknown.
 */
export function isLidClosed(): boolean {
	return getLidState() === "closed";
}

/**
 * Get the current lid state as a string.
 * @returns `"closed"` | `"open"` | `"unknown"`
 */
export function getLidState(): LidState {
	if (IS_MACOS) return macLidState();
	if (IS_LINUX) return linuxLidState();
	return "unknown";
}
