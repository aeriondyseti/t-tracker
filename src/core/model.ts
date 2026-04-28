// Core data models and zod schemas
import { z } from "zod";

// Status constants
export const STATUSES = ["inbox", "active", "blocked", "done", "archived"] as const;
export type Status = (typeof STATUSES)[number];

// Zod schemas
export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable(),
});

export const TaskSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  title: z.string(),
  status: z.enum(STATUSES),
  notes: z.string(),
  tags: z.array(z.string()),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable(),
});

// Inferred TypeScript types
export type Project = z.infer<typeof ProjectSchema>;
export type Task = z.infer<typeof TaskSchema>;

// Helper: current time in unix milliseconds
export function now(): number {
  return Date.now();
}

// Validation helpers
export function isValidStatus(status: string): status is Status {
  return STATUSES.includes(status as Status);
}
