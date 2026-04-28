#!/usr/bin/env bun
// CLI entry point

import { Command } from "commander";
import { now } from "../core/model.ts";
import { DaemonClient, resolveIDPrefix } from "./client.ts";
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

// Sync command - placeholder for Step 7
program
  .command("sync")
  .description("Force immediate sync with server")
  .action(() => {
    console.error("sync command not yet implemented (Step 7)");
    process.exit(1);
  });

program.parse();
