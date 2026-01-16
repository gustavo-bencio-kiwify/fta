import { z } from "zod";

export const slackUserIdSchema = z.string().regex(/^[UW][A-Z0-9]+$/);

export const createTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),

  delegation: slackUserIdSchema,   // quem criou
  responsible: slackUserIdSchema,  // responsável

  // No HTTP você estava usando z.coerce.date()
  // No Slack modal vem "YYYY-MM-DD" (string). Vamos aceitar ambos.
  term: z.union([z.coerce.date(), z.string(), z.null()]).optional(),

  recurrence: z.string().optional(),
  urgency: z.string().min(1),

  carbonCopies: z.array(slackUserIdSchema).default([]),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
