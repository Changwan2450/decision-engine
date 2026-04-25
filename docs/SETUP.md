# Setup Guide

## 1. Node Version

```bash
nvm install 22
nvm use 22
```

## 2. Install dependencies

```bash
pnpm install
```

## 3. Run project

```bash
pnpm cli --help
```

Or start the MCP server:

```bash
pnpm mcp
```

## 4. Obsidian setup (optional)

Vault path example:

```text
/Users/changwan2450/Antigravity WorkSpace/second-brain
```

Open this folder in Obsidian.

## 5. CLI setup (optional but required for cli_execute)

Install:
- `codex` CLI
- `claude` CLI

Verify:

```bash
codex --help
claude --help
```

## 6. Known Issues

- Node version mismatch warning if not using Node 22
- macOS subprocess permission issues
- CLI not found errors
- this repo is currently `CLI + MCP` first, not a browser app
