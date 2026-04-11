# Demo Flow

## Goal

Decision Engine -> CLI/MCP -> Advisory -> Obsidian

## Step 1: Create Project

```bash
pnpm cli create-project --name "Decision Engine Demo" --description "AI-first demo"
```

## Step 2: Create Run

```bash
pnpm cli create-run --project <projectId> --title "시장 진입 판단" --query "시장 진입 여부를 판단해줘"
```

## Step 3: Execute Internal Research

```bash
pnpm cli run-research --project <projectId> --run <runId>
pnpm cli show-run --project <projectId> --run <runId>
```

Observe:
- `decision`
- `evidence`
- `prdSeed`

## Step 4: Export Bundle

```bash
pnpm cli export-run-bundle --project <projectId> --run <runId>
```

Check:
- `workspace/{projectId}/runs/{runId}/bridge/bundle.json`
- `workspace/{projectId}/runs/{runId}/bridge/bundle.md`

## Step 5: External Advisory

Prompt-only:

```bash
pnpm cli execute-external --project <projectId> --run <runId> --provider codex
```

CLI execute:
- ensure `codex` or `claude` is installed
- run the same command in an environment where the CLI binary exists
- then ingest:

```bash
pnpm cli ingest-advisory --project <projectId> --run <runId> --provider codex
```

## Step 6: MCP Access

```bash
pnpm mcp
```

Example tool calls:
- `get_run`
- `query_events`
- `query_runs`

## Step 7: Obsidian 확인

Open vault and check:
- `DecisionEngine/projects/{projectName}/runs/{runId}.md`
- `DecisionEngine/projects/{projectName}/insights.md`
- `DecisionEngine/projects/{projectName}/decision-history.md`

## Expected Outcome

- decision created
- advisory appended without overwrite
- kb context reinjected into future bundles
- knowledge exported
