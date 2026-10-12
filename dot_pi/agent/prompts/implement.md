---
description: Full implementation flow with review only when risk warrants it.
---

1. **Switch branch.** Check the current branch with `git branch --show-current`. If
   it is `main` or `master`, come up with a suitable branch name and call
   `isolated_new_branch` with it; it creates the branch in a managed worktree and
   continues the session there. If it is refused (e.g. dirty checkout), stop and use
   `question` to ask the user whether to proceed on the current branch.
2. **Plan (only if needed).** If `$@` is empty (no argument provided), STOP and ask
   the user to call this prompt again with an argument. Call the `subagent` tool with
   `agent: "planner"`, a 1–5-word `taskName` summarising `$@`, and `task: "$@"` only
   when the request is broad, ambiguous, complex, or naturally decomposes into
   parallel items. For a clear single-workstream change, skip planning.
3. **Build.** Without a plan, call one `subagent` with `agent: "builder"`, a 1–5-word
   `taskName` summarising `$@`, and `task` containing the request verbatim. With a
   plan, group its items by dependency. For each group of independent items, issue
   multiple separate `subagent` tool calls together, one per item, each with
   `agent: "builder"`, a 1–5-word `taskName` summarising the item, and `task`
   containing the plan's Goal and Assumptions sections plus the plan item quoted
   verbatim, so parallel builders share context. Include an instruction to commit
   before finishing. Wait for one group to finish before starting a group with
   dependent items.
4. **Review only when warranted.** Skip review for simple or low-risk changes. Call one
   `reviewer` only when the implementation has meaningful risk or complexity, or when
   the user explicitly requested review. Multiple workstreams alone do not require one.
   Set `task` to: "Audit the implementation of ABC in commits XYZ and return a verdict
   (LGTM / LGTM with nits / Needs changes / Block) with findings." Here `ABC` is the
   implemented task and `XYZ` is a list of commit hashes.
5. **Fix serious issues (if needed).** If the verdict is "Needs changes", treat its
   substantive findings like a plan. Do not send nits to builders. Group serious issues
   by dependency and, for each group of independent issues, issue multiple separate
   `subagent` tool calls together, one per issue, each with `agent: "builder"`, a
   1–5-word `taskName` summarising the fix, and `task` quoting the issue verbatim.
   Include an instruction to commit before finishing. Wait for one group to finish
   before starting a group with dependent issues. Do not call another reviewer after
   the fixes; the user can request a separate review if wanted. If a fix requires a
   material user-level decision or permission, ask the user under the
   questions-and-autonomy policy.
6. **Block.** If the reviewer returns "Block", surface the verdict and findings and ask
   the user how to proceed; do not send blocked findings to builders automatically.

Use only the `subagent`, `question`, `isolated_new_branch`, and `bash` tools; use
`bash` only to check the current branch.
