// fzf integration: interactive task picker
import { spawn, spawnSync } from "node:child_process";
import type { Project, Status, Task } from "../core/model.ts";
import type { DaemonClient } from "./client.ts";

const STATUS_CYCLE: Status[] = ["inbox", "active", "blocked", "done", "archived"];

export function nextStatus(s: Status): Status {
  const i = STATUS_CYCLE.indexOf(s);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
}

export function formatPickerLine(task: Task, projectMap: Map<string, string>): string {
  const shortID = task.id.slice(0, 8);
  const project = projectMap.get(task.project_id) ?? "unknown";
  const tags = task.tags.length > 0 ? `  #${task.tags.join(" #")}` : "";
  return `${shortID} [${task.status}] ${project}: ${task.title}${tags}`;
}

export function parsePickerLine(line: string): string | null {
  const m = line.match(/^([0-9a-f]{8})\s/);
  return m ? m[1] : null;
}

export function buildPickerInput(
  tasks: Task[],
  projects: Project[],
): { input: string; visibleIds: string[] } {
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const visible = tasks.filter(
    (t) => t.deleted_at === null && ["inbox", "active", "blocked"].includes(t.status),
  );
  return {
    input: visible.map((t) => formatPickerLine(t, projectMap)).join("\n"),
    visibleIds: visible.map((t) => t.id),
  };
}

export function fzfAvailable(): boolean {
  try {
    const r = spawnSync("fzf", ["--version"], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

interface FzfResult {
  status: number;
  key: string;
  selection: string;
}

function runFzf(input: string): Promise<FzfResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "fzf",
      [
        "--ansi",
        "--no-sort",
        "--expect=ctrl-e,ctrl-n,ctrl-d,enter,esc",
        "--header",
        "enter: cycle status  ctrl-e: edit  ctrl-n: new  ctrl-d: archive  esc: quit",
      ],
      { stdio: ["pipe", "pipe", "inherit"] },
    );

    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const lines = out.split("\n");
      resolve({
        status: code ?? 1,
        key: lines[0] ?? "",
        selection: lines[1] ?? "",
      });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

async function readLineFromStdin(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx !== -1) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buf.slice(0, idx).trim());
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

export async function runPicker(client: DaemonClient): Promise<void> {
  if (!fzfAvailable()) {
    console.error(
      "fzf not found. Install: https://github.com/junegunn/fzf  (brew install fzf, apt install fzf)",
    );
    process.exit(2);
  }

  while (true) {
    const { tasks, projects } = await client.listTasks();
    const { input } = buildPickerInput(tasks, projects);

    if (input.length === 0) {
      console.log("(no tasks)");
      return;
    }

    const result = await runFzf(input);
    const id = parsePickerLine(result.selection);

    if (result.key === "esc" || result.key === "") {
      return;
    }

    if (result.key === "ctrl-n") {
      const title = await readLineFromStdin("new task title: ");
      if (title.length > 0) {
        await client.createTask({ title });
      }
      continue;
    }

    if (!id) continue;

    const task = tasks.find((t) => t.id.startsWith(id));
    if (!task) continue;

    if (result.key === "enter") {
      await client.updateTask(task.id, { status: nextStatus(task.status) });
    } else if (result.key === "ctrl-d") {
      await client.updateTask(task.id, { status: "archived" });
    } else if (result.key === "ctrl-e") {
      // Editor wiring belongs to `t edit`; re-enter loop.
    }
  }
}
