import assert from "node:assert/strict";
import { test } from "node:test";
import { inhibitArgs } from "./linux.ts";

test("linux hold blocks idle, sleep and lid-switch handling until pi exits", () => {
	assert.deepEqual(inhibitArgs(4242), [
		"--what=idle:sleep:handle-lid-switch",
		"--who=pi",
		"--why=Pi agent run in progress",
		"--mode=block",
		"tail",
		"--pid=4242",
		"-f",
		"/dev/null",
	]);
});
