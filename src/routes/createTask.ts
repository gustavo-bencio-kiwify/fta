import { FastifyInstance } from "fastify";
import { WebClient } from "@slack/web-api";
import { z } from 'zod'
import { prisma } from "../lib/prisma";


export async function createTask(app:FastifyInstance) {

    const slackIDSecret = new WebClient(process.env.SLACK_BOT_TOKEN)

    app.post("/createTask", async (request, reply)=>{

        const slackUserIdSchema = z.string().regex(/^[UW][A-Z0-9]+$/);

        const createTaskSchema = z.object({
        title: z.string(),
        description: z.string().optional(),
        delegation: slackUserIdSchema,
        responsible: slackUserIdSchema,
        term: z.union([z.coerce.date(), z.null()]).optional(),
        recurrence: z.string().optional(),
        urgency: z.string(),
        carbonCopies: z.array(slackUserIdSchema)
    })

        const data = createTaskSchema.parse(request.body);
        await prisma.task.create({
  data: {
    title: data.title,
    description: data.description,
    delegation: data.delegation,
    responsible: data.responsible,
    term: data.term,
    urgency: data.urgency,
    recurrence: data.recurrence ?? "none",

    carbonCopies: {
      createMany: {
        data: data.carbonCopies.map((id) => ({ slackUserId: id })),
      },
    },
  },
});


    })
    
}