import { describe, expect, it } from "vitest";
import { assertRunTransition, createRun } from "@/lib/domain/runs";

describe("run transitions", () => {
  it("allows the planned happy path", () => {
    expect(() => assertRunTransition("draft", "collecting")).not.toThrow();
    expect(() => assertRunTransition("collecting", "synthesizing")).not.toThrow();
    expect(() => assertRunTransition("synthesizing", "decided")).not.toThrow();
  });

  it("rejects invalid backward transitions", () => {
    expect(() => assertRunTransition("decided", "collecting")).toThrow(
      "Invalid run transition: decided -> collecting"
    );
  });
});

describe("createRun", () => {
  it("defaults to standard mode and draft status", () => {
    const run = createRun({
      id: "run-1",
      projectId: "project-1",
      title: "숏츠 시장조사",
      now: "2026-04-09T00:00:00.000Z"
    });

    expect(run.mode).toBe("standard");
    expect(run.status).toBe("draft");
    expect(run.input.urls).toEqual([]);
  });
});
