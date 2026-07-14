import { z } from "zod";
import { IdSchema, ConfirmDeleteSchema, DryRunSchema, ReasonSchema } from "./common.js";

// Project boards & phases (BETA API, Projects add-on). Boards are to projects
// what pipelines are to deals; phases are the stages within a board.

export const ProjectBoardsListSchema = z.object({}).strict();

export const ProjectBoardsGetSchema = z.object({
  board_id: IdSchema.describe("The project board ID to retrieve"),
}).strict();

export const ProjectBoardsCreateSchema = z.object({
  name: z.string().min(1).describe("Board name"),
  order_nr: z.coerce.number().int().positive().optional().describe("Board position, between 1 and the number of boards + 1"),
}).strict();

export const ProjectBoardsUpdateSchema = z.object({
  board_id: IdSchema.describe("The project board ID to update"),
  name: z.string().min(1).optional().describe("Board name"),
  order_nr: z.coerce.number().int().positive().optional().describe("Board position, between 1 and the number of boards + 1"),
}).strict();

export const ProjectBoardsDeleteSchema = z.object({
  board_id: IdSchema.describe("The project board ID to delete. Deleting a board affects the projects and phases on it."),
  confirm: ConfirmDeleteSchema,
  dry_run: DryRunSchema,
  reason: ReasonSchema,
}).strict();

export const ProjectPhasesListSchema = z.object({
  board_id: IdSchema.describe("The board whose phases to list (required)"),
}).strict();

export const ProjectPhasesGetSchema = z.object({
  phase_id: IdSchema.describe("The project phase ID to retrieve"),
}).strict();

export const ProjectPhasesCreateSchema = z.object({
  name: z.string().min(1).describe("Phase name"),
  board_id: IdSchema.describe("The board to add the phase to"),
  order_nr: z.coerce.number().int().positive().optional().describe("Phase position within the board, between 1 and the number of phases + 1"),
}).strict();

export const ProjectPhasesUpdateSchema = z.object({
  phase_id: IdSchema.describe("The project phase ID to update"),
  name: z.string().min(1).optional().describe("Phase name"),
  board_id: z.coerce.number().int().positive().optional().describe("Move the phase to this board"),
  order_nr: z.coerce.number().int().positive().optional().describe("Phase position within the board"),
}).strict();

export const ProjectPhasesDeleteSchema = z.object({
  phase_id: IdSchema.describe("The project phase ID to delete. Deleting a phase affects the projects currently in it."),
  confirm: ConfirmDeleteSchema,
  dry_run: DryRunSchema,
  reason: ReasonSchema,
}).strict();
