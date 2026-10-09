import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLinuxLidState } from "./lid.ts";

test("linux lid state is read from the ACPI button file", () => {
	assert.equal(parseLinuxLidState("state:      closed\n"), "closed");
	assert.equal(parseLinuxLidState("state:      open\n"), "open");
	assert.equal(parseLinuxLidState(""), "unknown");
});
