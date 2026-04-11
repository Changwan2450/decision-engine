#!/usr/bin/env tsx
import readline from "node:readline";
import { handleMcpRequest } from "@/lib/mcp/server";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  try {
    const request = JSON.parse(trimmed) as Parameters<typeof handleMcpRequest>[0];
    const response = await handleMcpRequest(request);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: error instanceof Error ? error.message : "Parse error"
        }
      })}\n`
    );
  }
});
