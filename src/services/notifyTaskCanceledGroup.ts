import type { WebClient } from "@slack/web-api";

async function openGroupDm(slack: WebClient, userIds: string[]) {
  const uniq = Array.from(new Set(userIds.filter(Boolean)));
  const conv = await slack.conversations.open({ users: uniq.join(",") });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open group DM channel");
  return channelId;
}

export async function notifyTaskCanceledGroup(args: {
    slack: WebClient;
    canceledBySlackId: string;
    responsibleSlackId: string;
    carbonCopiesSlackIds: string[];
    taskTitle: string;
}) {
    const { slack, canceledBySlackId, responsibleSlackId, carbonCopiesSlackIds, taskTitle } = args;

    // participantes: delegador + responsável + CCs
    const participants = [
        canceledBySlackId,
        responsibleSlackId,
        ...(carbonCopiesSlackIds ?? []),
    ];

    const channelId = await openGroupDm(slack, participants);

    const text = `❌ Tarefa cancelada por <@${canceledBySlackId}>`;

    await slack.chat.postMessage({
        channel: channelId,
        text,
    });
}
