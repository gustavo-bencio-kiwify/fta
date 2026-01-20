// src/schema/taskSchema.ts
import { z } from "zod";

const slackUserIdSchema = z.string().regex(/^[UW][A-Z0-9]+$/);

export const urgencySchema = z.enum(["light", "asap", "turbo"]);

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v),z.string().optional()),
  delegation: slackUserIdSchema,
  responsible: slackUserIdSchema,
  term: z.preprocess((v) => {
    if (v === null || v === undefined || v === "") return null;
    return v;
  }, z.coerce.date().nullable()).optional(),

  recurrence: z.string().optional(),
  urgency: urgencySchema,

  carbonCopies: z.array(slackUserIdSchema).optional().default([]),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
