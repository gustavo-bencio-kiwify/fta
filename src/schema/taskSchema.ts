// src/schema/taskSchema.ts
import { z } from "zod";

const slackUserIdSchema = z.string().regex(/^[UW][A-Z0-9]+$/);

export const urgencySchema = z.enum(["light", "asap", "turbo"]);

export const recurrenceSchema = z.enum([
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
]);

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),

  delegation: slackUserIdSchema,
  responsible: slackUserIdSchema,

  // Data do prazo (pode vir Date ou string YYYY-MM-DD)
  term: z.any().optional(),

  // ✅ NOVO
  deadlineTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/) // "HH:MM"
    .nullable()
    .optional(),

  recurrence: recurrenceSchema.nullable().optional(),

  projectId: z.string().uuid().nullable().optional(),

  urgency: urgencySchema,

  carbonCopies: z.array(slackUserIdSchema).optional().default([]),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
