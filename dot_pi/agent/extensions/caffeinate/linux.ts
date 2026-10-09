// Linux power hold: a logind inhibitor lock held for as long as the child
// lives. Unprivileged for an active local session, and it covers lid-close
// sleep too, so no sudoers drop-in or privileged watcher is needed. The held
// command exits with pi, so a crash cannot leave the lock behind.
export function inhibitArgs(piPid: number): string[] {
	return [
		"--what=idle:sleep:handle-lid-switch",
		"--who=pi",
		"--why=Pi agent run in progress",
		"--mode=block",
		"tail",
		`--pid=${piPid}`,
		"-f",
		"/dev/null",
	];
}
