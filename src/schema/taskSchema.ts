import { z } from "zod";

const slackUserIdSchema = z.string().regex(/^[UW][A-Z0-9]+$/);
export const urgencySchema = z.enum(["light", "asap", "turbo"]);

export const createTaskSchema = z.object({
  title: z.string().min(1),

  // ✅ opcional de verdade
  description: z.string().optional(),

  delegation: slackUserIdSchema,
  responsible: slackUserIdSchema,

  // aceita string/date, normaliza depois no service
  term: z.any().optional(),

  recurrence: z.string().optional(),
  urgency: urgencySchema,

  carbonCopies: z.array(slackUserIdSchema).optional().default([]),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
