"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTask = createTask;
const web_api_1 = require("@slack/web-api");
const zod_1 = require("zod");
const prisma_1 = require("../lib/prisma");
async function createTask(app) {
    const slackIDSecret = new web_api_1.WebClient(process.env.SLACK_BOT_TOKEN);
    app.post("/createTask", async (request, reply) => {
        const slackUserIdSchema = zod_1.z.string().regex(/^[UW][A-Z0-9]+$/);
        const createTaskSchema = zod_1.z.object({
            title: zod_1.z.string(),
            description: zod_1.z.string().optional(),
            delegation: slackUserIdSchema,
            responsible: slackUserIdSchema,
            term: zod_1.z.union([zod_1.z.coerce.date(), zod_1.z.null()]).optional(),
            recurrence: zod_1.z.string().optional(),
            urgency: zod_1.z.string(),
            carbonCopies: zod_1.z.array(slackUserIdSchema)
        });
        const data = createTaskSchema.parse(request.body);
        await prisma_1.prisma.task.create({
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
    });
}
