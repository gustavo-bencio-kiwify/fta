import { WebClient } from "@slack/web-api";
import { FastifyInstance } from "fastify";

export async function sendMessage(app:FastifyInstance){

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

app.post("/sendMessage", async (req, reply) => {
  try {
    const body = (req.body ?? {}) as { userId?: string; text?: string };

    const userId = body.userId;
    const text = body.text ?? "Olá! Push funcionando 🤖✅";
    if (!userId) {
  return reply.code(400).send({ ok: false, error: "userId is required" });
    }

    const conv = await slack.conversations.open({ users: userId });
    const channelId = conv.channel?.id;

    if (!channelId) {
      return reply.code(500).send({ ok: false, error: "Could not open DM channel" });
    }

    // 2) envia mensagem no canal (DM)
    const res = await slack.chat.postMessage({
      channel: channelId,
      text,
    });

    return reply.send({ ok: true, channelId, ts: res.ts });
  } catch (err: any) {
    req.log.error(err);
    return reply.code(500).send({ ok: false, error: err?.data ?? err?.message ?? "unknown error" });
  }
});
}