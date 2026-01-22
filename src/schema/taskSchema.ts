// src/schema/taskSchema.ts
import { z } from "zod";

const slackUserIdSchema = z.string().regex(/^[UW][A-Z0-9]+$/);

export const urgencySchema = z.enum(["light", "asap", "turbo"]);

// ✅ CC pode vir como "UXXXX" OU { slackUserId, email }
const carbonCopySchema = z.union([
  slackUserIdSchema,
  z.object({
    slackUserId: slackUserIdSchema,
    email: z.string().email().optional(),
  }),
]);

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),

  delegation: slackUserIdSchema,
  responsible: slackUserIdSchema,

  // continua livre, já que vem do Slack como string "YYYY-MM-DD"
  term: z.any().optional(),

  recurrence: z.string().optional(),
  urgency: urgencySchema,

  carbonCopies: z.array(carbonCopySchema).optional().default([]),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
