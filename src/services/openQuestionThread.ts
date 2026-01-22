// src/services/openQuestionThread.ts
import type { WebClient, KnownBlock } from "@slack/web-api";
import { prisma } from "../lib/prisma";

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function formatPrazoBR(term?: Date | null, deadlineTime?: string | null) {
  if (!term || Number.isNaN(term.getTime())) return null;

  const dateStr = term.toLocaleDateString("pt-BR");
  const time = deadlineTime?.trim();
  if (time) return `${dateStr} às ${time}`;
  return dateStr;
}

export async function openQuestionThread(args: {
  slack: WebClient;
  taskId: string;
  requestedBy: string; // quem clicou
}) {
  const { slack, taskId, requestedBy } = args;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      responsible: true,
      delegation: true,
      term: true,
      deadlineTime: true,
      urgency: true,
      carbonCopies: { select: { slackUserId: true } },
    },
  });

  if (!task) throw new Error(`Task not found: ${taskId}`);

  const ccIds = task.carbonCopies.map((c) => c.slackUserId);
  const participants = uniq([task.responsible, task.delegation, requestedBy, ...ccIds]);

  // Abre (ou reutiliza) DM em grupo (MPIM)
  const conv = await slack.conversations.open({ users: participants.join(",") });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open group DM (no channel id)");

  const prazo = formatPrazoBR(task.term ?? null, task.deadlineTime ?? null);

  const parentBlocks: KnownBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Dúvida sobre a atividade:* *${task.title}*` },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            `*Responsável:* <@${task.responsible}>  •  *Delegado por:* <@${task.delegation}>` +
            (prazo ? `  •  *Prazo:* ${prazo}` : ""),
        },
      ],
    },
    ...(task.description?.trim()
      ? ([
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Descrição:* ${task.description.trim()}` },
          },
        ] as KnownBlock[])
      : []),
    { type: "context", elements: [{ type: "mrkdwn", text: `UID: \`${task.id}\`` }] },
  ];

  const parent = await slack.chat.postMessage({
    channel: channelId,
    text: `Dúvida sobre a atividade: ${task.title}`,
    blocks: parentBlocks,
  });

  const threadTs = parent.ts;
  if (!threadTs) throw new Error("Could not create parent message (no ts)");

  // Posta um reply para “criar” a thread
  await slack.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: "Pessoal, podem ajudar nessa dúvida?",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `${participants.map((u) => `<@${u}>`).join(" ")}\n\n` +
            `👉 *Escreva a dúvida aqui nesta thread.*`,
        },
      },
    ],
  });

  return { channelId, threadTs };
}
