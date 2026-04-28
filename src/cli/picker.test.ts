import { describe, expect, test } from "bun:test";
import type { Project, Task } from "../core/model.ts";
import { buildPickerInput, formatPickerLine, nextStatus, parsePickerLine } from "./picker.ts";

function mkTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "abcdef0123456789",
    project_id: "p1",
    title: "do the thing",
    status: "inbox",
    notes: "",
    tags: [],
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
    ...overrides,
  };
}

function mkProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "inbox",
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
    ...overrides,
  };
}

describe("nextStatus", () => {
  test("cycles through all statuses and wraps", () => {
    expect(nextStatus("inbox")).toBe("active");
    expect(nextStatus("active")).toBe("blocked");
    expect(nextStatus("blocked")).toBe("done");
    expect(nextStatus("done")).toBe("archived");
    expect(nextStatus("archived")).toBe("inbox");
  });
});

describe("formatPickerLine", () => {
  test("formats short id, status, project, title", () => {
    const t = mkTask({ status: "active", title: "ship it" });
    const map = new Map([["p1", "work"]]);
    expect(formatPickerLine(t, map)).toBe("abcdef01 [active] work: ship it");
  });

  test("includes tags when present", () => {
    const t = mkTask({ tags: ["urgent", "dev"] });
    const map = new Map([["p1", "work"]]);
    expect(formatPickerLine(t, map)).toBe("abcdef01 [inbox] work: do the thing  #urgent #dev");
  });

  test("falls back to 'unknown' when project is missing", () => {
    const t = mkTask({ project_id: "missing" });
    expect(formatPickerLine(t, new Map())).toContain("unknown");
  });
});

describe("parsePickerLine", () => {
  test("extracts the leading 8-hex short id", () => {
    expect(parsePickerLine("abcdef01 [active] work: ship it")).toBe("abcdef01");
  });

  test("returns null when no id prefix", () => {
    expect(parsePickerLine("garbage")).toBeNull();
    expect(parsePickerLine("")).toBeNull();
  });
});

describe("buildPickerInput", () => {
  test("hides done, archived, and deleted tasks", () => {
    const tasks: Task[] = [
      mkTask({ id: "11111111aaaa", status: "inbox" }),
      mkTask({ id: "22222222bbbb", status: "active" }),
      mkTask({ id: "33333333cccc", status: "blocked" }),
      mkTask({ id: "44444444dddd", status: "done" }),
      mkTask({ id: "55555555eeee", status: "archived" }),
      mkTask({ id: "66666666ffff", status: "inbox", deleted_at: 1 }),
    ];
    const { input, visibleIds } = buildPickerInput(tasks, [mkProject()]);
    expect(visibleIds).toEqual(["11111111aaaa", "22222222bbbb", "33333333cccc"]);
    expect(input.split("\n")).toHaveLength(3);
  });

  test("returns empty input when no visible tasks", () => {
    const { input, visibleIds } = buildPickerInput([], []);
    expect(input).toBe("");
    expect(visibleIds).toEqual([]);
  });
});
