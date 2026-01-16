import { z } from "zod";
import { Urgency } from "../generated/prisma/enums" 

const slackUserIdSchema = z.string().regex(/^[UW][A-Z0-9]+$/);

export const createTaskSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  delegation: slackUserIdSchema,
  responsible: slackUserIdSchema,
  term: z.union([z.coerce.date(), z.string(), z.null()]).optional(),
  recurrence: z.string().optional(),
  urgency: z.nativeEnum(Urgency), // ✅ aqui
  carbonCopies: z.array(slackUserIdSchema).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
