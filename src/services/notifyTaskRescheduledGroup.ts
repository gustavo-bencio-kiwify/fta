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

function uniq(ids: Array<string | null | undefined>) {
  return Array.from(new Set(ids.filter(Boolean))) as string[];
}

function buildAlignThreadText(args: {
  responsibleSlackId: string;
  delegationSlackId: string | null;
  carbonCopiesSlackIds: string[];
}) {
  const { responsibleSlackId, delegationSlackId, carbonCopiesSlackIds } = args;

  const all = uniq([
    responsibleSlackId,
    delegationSlackId,
    ...(carbonCopiesSlackIds ?? []),
  ]);

  const mentions = all.map(mention).join(", ");

  // ✅ exatamente como você pediu:
  // "🗨️<Responsável>, <Delegador>, <Cópias>, Alinhem aqui caso necessário."
  // (sem cópias se não tiver; sem delegador se null)
  return `🗨️ ${mentions}, alinhem aqui caso necessário.`;
}

async function openGroupDm(slack: WebClient, userIds: string[]) {
  const users = uniq(userIds).join(",");
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

async function postWithThread(slack: WebClient, channel: string, rootText: string, threadText: string) {
  const root = await slack.chat.postMessage({
    channel,
    text: rootText,
  });

  const threadTs = root.ts;
  if (!threadTs) return;

  await slack.chat.postMessage({
    channel,
    text: threadText,
    thread_ts: threadTs,
  });
}

export async function notifyTaskRescheduledGroup(args: NotifyTaskRescheduledGroupArgs) {
  const {
    slack,
    responsibleSlackId,
    delegationSlackId,
    carbonCopiesSlackIds,
    taskTitle,
    newDateBr,
  } = args;

  // participantes: responsável + delegador + CCs (sem duplicar)
  const participants = uniq([
    responsibleSlackId,
    delegationSlackId,
    ...(carbonCopiesSlackIds ?? []),
  ]);

  if (!participants.length) return;

  // ✅ Mensagem raiz (normal)
  const rootText = `📅 ${mention(responsibleSlackId)} reprogramou a atividade *${taskTitle}* para *${newDateBr}*`;

  // ✅ Mensagem na thread (com mentions)
  const threadText = buildAlignThreadText({
    responsibleSlackId,
    delegationSlackId,
    carbonCopiesSlackIds,
  });

  // ✅ tenta MPIM
  try {
    const channelId = await openGroupDm(slack, participants);
    await postWithThread(slack, channelId, rootText, threadText);
    return;
  } catch (e) {
    console.error("[notifyTaskRescheduledGroup] openGroupDm failed, falling back to DMs:", e);
  }

  // fallback: DMs individuais
  await Promise.allSettled(
    participants.map(async (uid) => {
      try {
        const channelId = await openDm(slack, uid);
        await postWithThread(slack, channelId, rootText, threadText);
      } catch (e) {
        console.error("[notifyTaskRescheduledGroup] DM failed:", { uid, e });
      }
    })
  );
}
