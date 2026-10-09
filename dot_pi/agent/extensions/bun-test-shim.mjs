// Minimal `bun:test` subset on top of node:test, aliased in by test-runner.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

export { test };

const matchObject = (actual, expected) => {
	for (const [key, value] of Object.entries(expected)) assert.deepStrictEqual(actual[key], value);
};

const matchers = (actual, negate = false) => {
	const check = (pass, fn) => (negate ? assert.ok(!pass) : fn());
	return {
		toBe: (expected) => check(Object.is(actual, expected), () => assert.strictEqual(actual, expected)),
		toEqual: (expected) => (negate ? assert.notDeepStrictEqual(actual, expected) : assert.deepStrictEqual(actual, expected)),
		toBeUndefined: () => check(actual === undefined, () => assert.strictEqual(actual, undefined)),
		toBeGreaterThanOrEqual: (n) => check(actual >= n, () => assert.ok(actual >= n, `${actual} >= ${n}`)),
		toBeLessThanOrEqual: (n) => check(actual <= n, () => assert.ok(actual <= n, `${actual} <= ${n}`)),
		toMatchObject: (expected) => matchObject(actual, expected),
		toThrow: () => (negate ? assert.doesNotThrow(actual) : assert.throws(actual)),
	};
};

const settled = (promise, wantRejected) =>
	new Proxy({}, {
		get: (_, name) => async (...args) => {
			let value;
			let rejected = false;
			try {
				value = await promise;
			} catch (error) {
				value = error;
				rejected = true;
			}
			assert.strictEqual(rejected, wantRejected, wantRejected ? "expected rejection" : "expected resolution");
			return matchers(value)[name](...args);
		},
	});

export const expect = (actual) => ({
	...matchers(actual),
	not: matchers(actual, true),
	resolves: settled(actual, false),
	rejects: settled(actual, true),
});
