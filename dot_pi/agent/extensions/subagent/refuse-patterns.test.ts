import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Point pi's agent dir at the repo copy so we test the real frontmatter.
process.env.PI_CODING_AGENT_DIR = path.resolve(here, "..", "..");

const { discoverAgents } = await import("./agents.ts");

const agents = discoverAgents(here, "user").agents;

function refusedBy(agentName: string, task: string): string | undefined {
	const agent = agents.find((a) => a.name === agentName);
	assert.ok(agent, `agent ${agentName} not found`);
	for (const rule of agent.refuse ?? []) {
		if (new RegExp(rule.pattern, rule.flags ?? "i").test(task)) return rule.pattern;
	}
	return undefined;
}

const bigBlock = "```ts\n" + "const x = 1;\n".repeat(200) + "```";

const cases: Record<string, { ok: string[]; bad: string[] }> = {
	builder: {
		ok: [
			"Fix the parser. Only commit locally; never publish to the remote.",
			"Do not push, pull, or rebase. Commit with a conventional message.",
			"Don't git push or rebase onto main; the harness merges.",
			"Add a push-notification toggle to settings.ts.",
			"Never force-push. Update README.md.",
		],
		bad: [
			bigBlock,
			"Here is the full file contents of foo.ts",
			"Return the full file contents of foo.ts",
			"Explore the codebase and then fix things",
			"Fix it and then git push to origin.",
			"Force-push the branch when done.",
			"Then rebase onto main.",
		],
	},
	reviewer: {
		ok: [
			"Review the push-notification change in HEAD~2..HEAD.",
			"Checkout the branch diff with git diff main...HEAD and review it.",
			"Review whether the change will fix the bugs reported in #12.",
			"Review HEAD~1. Do not fix the issues; just report them.",
			"Verify the builder did not git push anything.",
		],
		bad: [
			bigBlock,
			"Here is the full diff",
			"Review HEAD~1. Fix the issues you find.",
			"Review and please apply the findings.",
			"Review, then git commit --amend with a better message.",
			"Force-push the fixed branch.",
			"git checkout main and compare.",
		],
	},
	explorer: {
		ok: [
			"How do we build the Docker image?",
			"Find where to implement rate limiting in the API.",
			"Locate the code that would need to change to add the endpoint.",
			"Which module should we refactor first? Summarise options.",
			"Don't implement anything; just locate the config loader.",
		],
		bad: [
			bigBlock,
			"Here is the full source of main.ts",
			"Give me the full file contents of main.ts",
			"Implement rate limiting in api.ts.",
			"Find the loader. Then add a new function to parse YAML.",
			"Please refactor utils.ts.",
			"Reproduce the module verbatim.",
		],
	},
	planner: {
		ok: [
			"Plan the change; the orchestrator will run the builder and then the reviewer.",
			"Plan how to fix the bug without just doing a quick hack.",
			"Plan a migration. The plan should call the builder once per step.",
			"Don't skip the plan; outline steps for the refactor.",
		],
		bad: [
			bigBlock,
			"Here is the full file",
			"Show me the full file contents of a.ts",
			"Just do it.",
			"Go ahead and implement the feature.",
			"Plan it. Then spawn the builder.",
			"Please call the reviewer afterwards.",
		],
	},
};

for (const [name, { ok, bad }] of Object.entries(cases)) {
	test(`${name}: benign tasks pass refuse rules`, () => {
		for (const task of ok) {
			assert.equal(refusedBy(name, task), undefined, `wrongly refused: ${task}`);
		}
	});
	test(`${name}: bad tasks are refused`, () => {
		for (const task of bad) {
			assert.ok(refusedBy(name, task), `not refused: ${task.slice(0, 80)}`);
		}
	});
}
