import type { WebClient } from "@slack/web-api";

async function openGroupDm(slack: WebClient, userIds: string[]) {
  const uniq = Array.from(new Set(userIds.filter(Boolean)));
  const conv = await slack.conversations.open({ users: uniq.join(",") });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open group DM channel");
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

function uniqMentions(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function mention(id: string) {
  return `<@${id}>`;
}

export async function notifyTaskCanceledGroup(args: {
  slack: WebClient;
  canceledBySlackId: string;
  responsibleSlackId: string;
  carbonCopiesSlackIds: string[];
  taskTitle: string;
}) {
  const { slack, canceledBySlackId, responsibleSlackId, carbonCopiesSlackIds, taskTitle } = args;

  // participantes: quem cancelou + responsável + CCs
  const participants = [canceledBySlackId, responsibleSlackId, ...(carbonCopiesSlackIds ?? [])];

  const channelId = await openGroupDm(slack, participants);

  // ✅ Mensagem raiz
  const rootText = `❌ Tarefa cancelada!`;

  // ✅ demais envolvidos (sem duplicar e sem repetir o canceledBy)
  const others = uniqMentions([responsibleSlackId, ...(carbonCopiesSlackIds ?? [])]).filter(
    (id) => id !== canceledBySlackId
  );

  const othersText = others.length ? `${others.map(mention).join(", ")}` : "";

  // ✅ Mensagem na thread
  const threadText = `:bell: Tarefa *${taskTitle}* cancelada por ${mention(canceledBySlackId)}.\n FYI: ${othersText}`;

  await postWithThread(slack, channelId, rootText, threadText);
}
