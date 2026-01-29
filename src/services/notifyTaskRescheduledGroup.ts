// src/services/notifyTaskRescheduledGroup.ts
import type { WebClient } from "@slack/web-api";

type NotifyTaskRescheduledGroupArgs = {
  slack: WebClient;
  responsibleSlackId: string;
  delegationSlackId: string | null;
  carbonCopiesSlackIds: string[];
  taskTitle: string;
  newDateBr: string; // "dd/mm/yyyy" (ou "dd/mm/yyyy às HH:MM")
};

function mention(id: string) {
  return `<@${id}>`;
}

async function openGroupDm(slack: WebClient, userIds: string[]) {
  const users = userIds.join(",");
  const conv = await slack.conversations.open({ users });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open group DM channel");
  return channelId;
}

async function openDm(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM channel");
  return channelId;
}

export async function notifyTaskRescheduledGroup(args: NotifyTaskRescheduledGroupArgs) {
  const { slack, responsibleSlackId, delegationSlackId, carbonCopiesSlackIds, taskTitle, newDateBr } = args;

  const participants = Array.from(
    new Set([responsibleSlackId, delegationSlackId, ...(carbonCopiesSlackIds ?? [])].filter(Boolean))
  ) as string[];

  if (!participants.length) return;

  const text =
    `📅 ${mention(responsibleSlackId)} reprogramou a atividade *${taskTitle}* para *${newDateBr}*\n\n` +
    `🗨️ Alinhem aqui caso necessário.`;

  // ✅ tenta MPIM
  try {
    const channelId = await openGroupDm(slack, participants);
    await slack.chat.postMessage({ channel: channelId, text });
    return;
  } catch (e) {
    console.error("[notifyTaskRescheduledGroup] openGroupDm failed, falling back to DMs:", e);
  }

  // fallback: DMs individuais (não falha por falta de scope mpim)
  await Promise.allSettled(
    participants.map(async (uid) => {
      try {
        const channelId = await openDm(slack, uid);
        await slack.chat.postMessage({ channel: channelId, text });
      } catch (e) {
        console.error("[notifyTaskRescheduledGroup] DM failed:", { uid, e });
      }
    })
  );
}
