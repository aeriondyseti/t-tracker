#!/usr/bin/env bun
// CLI entry point

import { existsSync } from "node:fs";
import { Command } from "commander";
import { now } from "../core/model.ts";
import { DaemonClient, resolveIDPrefix } from "./client.ts";
import {
  configPath,
  defaultConfig,
  execLogs,
  loadConfig,
  pollHealth,
  runInit,
  runShellCommand,
  runStatus,
  serviceCommands,
} from "./lifecycle.ts";
import { runPicker } from "./picker.ts";

const program = new Command();
const client = new DaemonClient();

program
  .name("t")
  .description("Frictionless CLI task tracker with daemon and sync")
  .version("0.1.0");

// Default command: fzf picker
program.action(async () => {
  try {
    if (!(await client.health())) {
      console.error("daemon not running; run 't daemon start' or 't init'");
      process.exit(2);
    }
    await runPicker(client);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
});

// Add command
program
  .command("add")
  .description("Create a new task")
  .argument("<title>", "Task title")
  .option("--project <name>", "Project name", "inbox")
  .option("--tag <tag...>", "Tags (can be specified multiple times)")
  .action(async (title: string, options: { project: string; tag?: string[] }) => {
    try {
      if (!(await client.health())) {
        console.error("daemon not running; run 't daemon start' or 't init'");
        process.exit(2);
      }

      const task = await client.createTask({
        title,
        project: options.project,
        tags: options.tag,
      });

      console.log(task.id);
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// List command
program
  .command("ls")
  .description("List tasks")
  .option("--all", "Include done and archived tasks")
  .option("--project <name>", "Filter by project")
  .option("--status <status>", "Filter by status")
  .option("--tag <tag>", "Filter by tag")
  .action(async (options: { all?: boolean; project?: string; status?: string; tag?: string }) => {
    try {
      if (!(await client.health())) {
        console.error("daemon not running; run 't daemon start' or 't init'");
        process.exit(2);
      }

      const { tasks, projects } = await client.listTasks();

      // Build project name map
      const projectMap = new Map(projects.map((p) => [p.id, p.name]));

      // Filter tasks
      const filtered = tasks.filter((t) => {
        // Skip deleted
        if (t.deleted_at !== null) return false;

        // Filter by status (default: show only inbox+active+blocked)
        if (!options.all && !["inbox", "active", "blocked"].includes(t.status)) {
          return false;
        }
        if (options.status && t.status !== options.status) {
          return false;
        }

        // Filter by project
        if (options.project) {
          const projectName = projectMap.get(t.project_id);
          if (projectName !== options.project) return false;
        }

        // Filter by tag
        if (options.tag && !t.tags.includes(options.tag)) {
          return false;
        }

        return true;
      });

      // Output tab-separated
      for (const t of filtered) {
        const shortID = t.id.slice(0, 8);
        const projectName = projectMap.get(t.project_id) || "unknown";
        const tags = t.tags.join(",");
        console.log(`${shortID}\t${t.status}\t${projectName}\t${t.title}\t${tags}`);
      }
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Status change commands
const statusCommands = [
  { name: "done", status: "done", description: "Mark task as done" },
  { name: "start", status: "active", description: "Mark task as active" },
  { name: "block", status: "blocked", description: "Mark task as blocked" },
  { name: "archive", status: "archived", description: "Archive task" },
];

for (const { name, status, description } of statusCommands) {
  program
    .command(name)
    .description(description)
    .argument("<id-prefix>", "Task ID or prefix")
    .action(async (idPrefix: string) => {
      try {
        if (!(await client.health())) {
          console.error("daemon not running; run 't daemon start' or 't init'");
          process.exit(2);
        }

        const id = await resolveIDPrefix(client, idPrefix);
        await client.updateTask(id, { status });
      } catch (err) {
        console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

// Edit command - placeholder (needs $EDITOR integration)
program
  .command("edit")
  .description("Edit task notes in $EDITOR")
  .argument("<id-prefix>", "Task ID or prefix")
  .action(() => {
    console.error("edit command not yet fully implemented");
    process.exit(1);
  });

// Projects command
program
  .command("projects")
  .description("List all projects")
  .action(async () => {
    try {
      if (!(await client.health())) {
        console.error("daemon not running; run 't daemon start' or 't init'");
        process.exit(2);
      }

      const projects = await client.listProjects();
      for (const p of projects) {
        console.log(p.name);
      }
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Project subcommand
const projectCmd = program.command("project").description("Manage projects");

projectCmd
  .command("add")
  .description("Create a new project")
  .argument("<name>", "Project name")
  .action(async (name: string) => {
    try {
      if (!(await client.health())) {
        console.error("daemon not running; run 't daemon start' or 't init'");
        process.exit(2);
      }

      const project = await client.createProject(name);
      console.log(project.id);
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

projectCmd
  .command("rm")
  .description("Soft delete a project")
  .argument("<name>", "Project name")
  .action(async (name: string) => {
    try {
      if (!(await client.health())) {
        console.error("daemon not running; run 't daemon start' or 't init'");
        process.exit(2);
      }

      const projects = await client.listProjects();
      const project = projects.find((p) => p.name === name);

      if (!project) {
        console.error(`project not found: ${name}`);
        process.exit(1);
      }

      await client.updateProject(project.id, { deleted_at: now() });
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// Sync command - daemon hits its own /sync endpoint when implemented;
// for now invoke the engine via daemon by triggering a write that pings.
program
  .command("sync")
  .description("Force immediate sync with server")
  .action(async () => {
    try {
      if (!(await client.health())) {
        console.error("daemon not running; run 't daemon start' or 't init'");
        process.exit(2);
      }
      const res = await fetch("http://127.0.0.1:9999/sync", { method: "POST" });
      if (!res.ok) {
        console.error(`sync: HTTP ${res.status}`);
        process.exit(1);
      }
      console.log(await res.text());
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// --- Lifecycle commands (Step 9) ---

const platform = process.platform;

program
  .command("init")
  .description("One-time per-machine setup (idempotent)")
  .option("--server-url <url>", "Server URL (skips prompt)")
  .option("--server-token <token>", "Server token (skips prompt)")
  .action(async (opts: { serverUrl?: string; serverToken?: string }) => {
    try {
      const result = await runInit(platform, {
        serverUrl: opts.serverUrl,
        serverToken: opts.serverToken,
      });
      if (result.wroteConfig) {
        console.log(`wrote ${result.configPath}`);
        if (!opts.serverToken) {
          console.log("set server_token in the config before sync will work");
        }
      } else {
        console.log(`config already exists at ${result.configPath}`);
      }
      const start = serviceCommands(platform).start;
      const r = runShellCommand(start);
      if (r.status !== 0) {
        console.error(`failed to start daemon via ${start.command}: ${r.stderr.trim()}`);
        console.error(
          "if the service unit is not yet installed, render and install it from src/core/service.ts (Step 8)",
        );
        process.exit(2);
      }
      const ok = await pollHealth("http://127.0.0.1:9999", 5000);
      if (!ok) {
        console.error("daemon did not become healthy within 5s; check 't daemon logs'");
        process.exit(2);
      }
      console.log("✓ daemon running");
    } catch (err) {
      console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

const daemonCmd = program.command("daemon").description("Daemon lifecycle");

for (const action of ["start", "stop", "restart"] as const) {
  daemonCmd
    .command(action)
    .description(`${action} the daemon via the platform service manager`)
    .action(() => {
      const sc = serviceCommands(platform)[action];
      const r = runShellCommand(sc);
      if (r.status !== 0) {
        console.error(`${action} failed: ${r.stderr.trim() || `exit ${r.status}`}`);
        process.exit(2);
      }
    });
}

daemonCmd
  .command("logs")
  .description("Tail daemon logs")
  .option("--follow", "follow new log entries")
  .action((opts: { follow?: boolean }) => {
    execLogs(platform, opts.follow === true);
  });

program
  .command("status")
  .description("Daemon health, sync state, task counts")
  .action(async () => {
    const cfgPath = configPath(platform);
    const cfg = existsSync(cfgPath) ? loadConfig(cfgPath) : defaultConfig();
    const report = await runStatus(platform, client, cfg);
    if (report.daemon === "not_running") {
      console.log("daemon: not running");
      process.exit(0);
    }
    console.log(`daemon: running${report.pid !== null ? ` (pid: ${report.pid})` : ""}`);
    console.log(`port: ${report.daemonPort}`);
    console.log(`server: ${report.serverURL} (${report.serverReachable ? "ok" : "unreachable"})`);
    const counts = Object.entries(report.taskCounts).sort();
    if (counts.length === 0) {
      console.log("tasks: 0");
    } else {
      console.log(`tasks: ${counts.map(([s, n]) => `${s}=${n}`).join(" ")}`);
    }
  });

program.parse();
