# Codex to CodeBuddy over A2A

A small local command client and session owner for delegating tool-free tasks to CodeBuddy. Related tasks reuse one live conversation. Codex supplies context and independently reviews returned artifacts.

## Requirements and tested scope

- Windows, Node.js with built-in `node:test`, and npm-installed CodeBuddy CLI.
- Tested with CodeBuddy 2.183.0. Sign in using your own CodeBuddy account before starting.
- The current script locates the npm entry at `%APPDATA%/npm/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy`. Custom npm prefixes, standalone installations, macOS and Linux are not validated/supported by this distribution.
- No npm dependencies, API keys or separate OAuth app registration are required by this script. Your account's model availability and quota still apply. Model IDs are discovered on first use and cached; no hardcoded default or automatic paid fallback.

## Model discovery and task-based selection

```powershell
node .\a2a_worker.cjs models
node .\a2a_worker.cjs models --refresh true
```

Discovery uses ACP initialize/session-new metadata only, without sending a prompt or changing the global model. Task execution still uses A2A. The per-user cache is `~/.codex/codebuddy/model-catalog.json`; it refreshes after 24 hours or CLI version changes. Refresh manually after login/account changes. Catalog visibility does not prove account quota or successful inference. Only safe metadata is stored; credentials and raw configuration are not cached. Do not distribute your machine's cache.

`serve --tier simple` and `serve --tier routine` select an advertised zero-rate candidate by default (largest reported context as tie-break; this is not a quality ranking). If no zero-rate candidate exists, selection stops instead of automatically charging for a paid model. `--model <discovered-id>` explicitly selects another model. `--tier complex` requires an explicit model or reviewed mapping; names and prices cannot establish capability.

To map tiers, copy `model-policy.example.json` to `~/.codex/codebuddy/model-policy.json` (or supply `--policy-file ABSOLUTE_PATH`) and replace its IDs/reasons using the actual catalog and your accepted-work evidence. Paid mappings are explicit cost decisions. Removed/disabled mapped models fail rather than silently switching. The example is a schema template, not a ready-to-use model recommendation. Missing tiers keep the default behavior above.

Codex should inspect `models`, select the least costly suitable candidate using task complexity and observed quality, then pass `--model` when needed. New/changed models need evaluation; metadata does not provide a reliable capability ranking. Sessions pin the model at startup, so use a different session when changing models. Selection details and cache observation time are recorded in session.json.

## Run

Extract the files into a directory. In PowerShell, change to that directory. Start a new session in terminal A (leave it running):

```powershell
node .\a2a_worker.cjs serve --session-dir "$PWD\sessions\example" --tier routine
```

Use a new session directory; existing directories are intentionally rejected. In terminal B, change to the same extracted directory, write `task.txt` in UTF-8, then submit:

```powershell
node .\a2a_worker.cjs send --session-dir "$PWD\sessions\example" --task-file "$PWD\task.txt"
```

Copy the returned `taskId` into the wait command:

```powershell
node .\a2a_worker.cjs wait --session-dir "$PWD\sessions\example" --task-id TASK_ID
```

For related follow-ups, create another UTF-8 task file and repeat `send` and `wait` using the SAME session directory. The owner automatically reuses its contextId. Finish/wait for the current task before submitting another. Different projects or unrelated work need different session directories.

Other commands:

```powershell
node .\a2a_worker.cjs status --session-dir "$PWD\sessions\example"
node .\a2a_worker.cjs get --session-dir "$PWD\sessions\example" --task-id TASK_ID
node .\a2a_worker.cjs cancel --session-dir "$PWD\sessions\example" --task-id TASK_ID
node .\a2a_worker.cjs close --session-dir "$PWD\sessions\example"
```

`close` refuses while a task is active; finish or cancel it first. For INPUT_REQUIRED, inspect the local task snapshot and respond using `answer --session-dir ... --task-id ... --task-file ...`. This path is implemented but has not been live-tested. AUTH_REQUIRED needs human authorization, not a permission bypass.

## Using from Codex

Give Codex the absolute script path and these rules (merge into your own instructions, do not overwrite existing project rules):

> Use a2a_worker.cjs for CodeBuddy delegation. Read `models` first and select from its cached/current catalog by cost, task requirements and accepted-work evidence; never assume a specific model ID remains available. Start `serve` through a long-running command session and retain its execution session ID. Submit UTF-8 task files with `send`; track the returned taskId with `wait`/`get`. A short command-tool yield must not terminate the owner or task. Reuse the same live session for related work, one active task at a time. Supply scope, necessary nonsecret context and independent acceptance criteria. Review returned code and test it before integration. Never silently resubmit after a connection failure or change to a paid model. Close idle sessions after the work is finished.

## Behavior and limits

- Uses A2A SendMessage/GetTask/CancelTask over local stdio. A fixed `--session-id` and stream-json mixed mode keep related A2A turns attached to one CodeBuddy conversation.
- The owner exposes a local named pipe. This is for trusted local use, not a network API or multi-user security boundary.
- Built-in tools and MCP are disabled, user/project settings are skipped, and CodeBuddy runs in an empty session workspace. It returns text/code; it does not directly modify your project. This is not an OS sandbox.
- There is no wrapper total timeout. A live process does not prove model progress. Query, inspect and cancel when needed.
- Context exists while the owner and CodeBuddy process remain alive. No automatic restart recovery or durable execution guarantee. Context windows remain finite.
- `validated: true` means a completed task with a nonempty Answer artifact, not independently correct work. Failed tasks return a nonzero wait/get exit code. INPUT_REQUIRED/AUTH_REQUIRED are interrupted states, not success.
- Session directories contain prompts, answers, task snapshots and logs; snapshots may contain reasoning. Keep them private and out of Git. Do not distribute credentials or session data.
- Live checks covered exact Chinese/Unicode transport, two-turn label recall using the same contextId, result retrieval and task cancellation. This is not a production load/recovery/security certification.

## Offline checks

```powershell
node --test .\test_a2a_worker.cjs .\test_model_catalog.cjs
```

The tests make no model calls. This distribution contains the runtime modules, regression checks, a policy schema example and this guide; no personal configuration, catalog or sessions.
