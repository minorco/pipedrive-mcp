import { z } from "zod";
import {
  IdSchema,
  LimitSchema,
  PageTokenSchema,
  ConfirmDeleteSchema,
  DryRunSchema,
  ReasonSchema,
} from "./common.js";

// Pipedrive project tasks (BETA API, Projects add-on). These are the tasks
// inside Projects - NOT the "task" activity type on the activities endpoints.

export const ProjectTasksListSchema = z.object({
  project_id: z.coerce.number().int().positive().optional().describe("Only tasks in this project"),
  parent_task_id: z
    .union([z.coerce.number().int().positive(), z.literal("null")])
    .optional()
    .describe('Subtasks of this task ID, or the string "null" for root tasks only'),
  assignee_id: z.coerce.number().int().positive().optional().describe("Only tasks assigned to this user"),
  is_done: z.boolean().optional().describe("Filter by completion status"),
  is_milestone: z.boolean().optional().describe("Filter by milestone status"),
  cursor: PageTokenSchema,
  limit: LimitSchema,
}).strict();

export const ProjectTasksGetSchema = z.object({
  task_id: IdSchema.describe("The project task ID to retrieve"),
}).strict();

const taskWriteFields = {
  description: z.string().optional().describe("Task description"),
  done: z.boolean().optional().describe("Completion status"),
  milestone: z.boolean().optional().describe("Whether the task is a milestone"),
  due_date: z.string().optional().describe("Due date (YYYY-MM-DD)"),
  start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
  assignee_id: z.coerce.number().int().positive().optional().describe("Assignee user ID"),
  priority: z.coerce.number().int().optional().describe("Task priority"),
};

export const ProjectTasksCreateSchema = z.object({
  title: z.string().min(1).describe("Task title"),
  project_id: IdSchema.describe("The project the task belongs to"),
  parent_task_id: z
    .coerce.number().int().positive().optional()
    .describe("Parent task ID to create this as a subtask (the parent cannot itself be a subtask)"),
  ...taskWriteFields,
}).strict();

export const ProjectTasksUpdateSchema = z.object({
  task_id: IdSchema.describe("The project task ID to update"),
  title: z.string().min(1).optional().describe("Task title"),
  project_id: z.coerce.number().int().positive().optional().describe("Move the task to this project"),
  parent_task_id: z.coerce.number().int().positive().optional().describe("Parent task ID"),
  ...taskWriteFields,
}).strict();

export const ProjectTasksDeleteSchema = z.object({
  task_id: IdSchema.describe("The project task ID to delete. Deleting a task also deletes its subtasks."),
  confirm: ConfirmDeleteSchema,
  dry_run: DryRunSchema,
  reason: ReasonSchema,
}).strict();
