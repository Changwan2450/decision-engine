import { describe, expect, it } from "vitest";
import {
  digestSchema,
  inboxItemSchema,
  runRecordSchema,
  watchTargetSchema
} from "@/lib/storage/schema";

describe("watch schemas", () => {
  it("parses a minimal watch target", () => {
    const parsed = watchTargetSchema.parse({
      id: "watch-1",
      projectId: "project-1",
      title: "Short-form market watch",
      query: {
        naturalLanguage: "track short-form creator market",
        urls: ["https://example.com/source"]
      },
      sourceFilter: {},
      delivery: {
        digest: true,
        alert: false,
        inbox: true
      },
      tags: ["short-form", "creator"],
      status: "draft",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(parsed.tags).toEqual(["short-form", "creator"]);
    expect(parsed.delivery.digest).toBe(true);
    expect(parsed.schedule).toBeNull();
    expect(parsed.lastTriggeredAt).toBeNull();
  });

  it("parses an interval watch schedule", () => {
    const parsed = watchTargetSchema.parse({
      id: "watch-1",
      projectId: "project-1",
      title: "Short-form market watch",
      query: {
        naturalLanguage: "track short-form creator market",
        urls: ["https://example.com/source"]
      },
      sourceFilter: {},
      delivery: {
        digest: true,
        alert: false,
        inbox: true
      },
      tags: [],
      status: "active",
      schedule: {
        kind: "interval",
        intervalMs: 60000
      },
      lastTriggeredAt: "2026-04-18T00:00:00.000Z",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(parsed.schedule).toEqual({
      kind: "interval",
      intervalMs: 60000
    });
    expect(parsed.lastTriggeredAt).toBe("2026-04-18T00:00:00.000Z");
  });

  it("parses a digest with source run ids", () => {
    const parsed = digestSchema.parse({
      id: "digest-1",
      projectId: "project-1",
      watchTargetId: "watch-1",
      windowStart: "2026-04-10T00:00:00.000Z",
      windowEnd: "2026-04-17T00:00:00.000Z",
      sourceRunIds: ["run-1", "run-2"],
      headline: "weekly movement",
      summary: "two notable changes",
      status: "built",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(parsed.sourceRunIds).toEqual(["run-1", "run-2"]);
    expect(parsed.status).toBe("built");
  });

  it("parses an inbox item linked to a digest", () => {
    const parsed = inboxItemSchema.parse({
      id: "inbox-1",
      projectId: "project-1",
      kind: "digest",
      refId: "digest-1",
      watchTargetId: "watch-1",
      status: "unread",
      title: "weekly digest",
      summary: "summary",
      createdAt: "2026-04-17T00:00:00.000Z",
      updatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(parsed.kind).toBe("digest");
    expect(parsed.watchTargetId).toBe("watch-1");
  });

  it("defaults watchContext to null on existing run records", () => {
    const parsed = runRecordSchema.parse({
      run: {
        id: "run-1",
        projectId: "project-1",
        title: "market research",
        mode: "standard",
        status: "draft",
        clarificationQuestions: [],
        input: {
          urls: []
        },
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z"
      }
    });

    expect(parsed.watchContext).toBeNull();
  });

  it("round-trips run records with watchContext", () => {
    const input = {
      run: {
        id: "run-1",
        projectId: "project-1",
        title: "watch tick result",
        mode: "standard",
        status: "draft",
        clarificationQuestions: [],
        input: {
          urls: ["https://example.com/source"]
        },
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z"
      },
      watchContext: {
        watchTargetId: "watch-1",
        triggerId: "trigger-1",
        digestId: null
      }
    };

    const parsed = runRecordSchema.parse(input);
    expect(parsed.watchContext).toEqual(input.watchContext);
    expect(runRecordSchema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
});
