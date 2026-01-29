// src/services/notifyTaskCompleted.ts
import type { WebClient } from "@slack/web-api";

type NotifyTaskCompletedArgs = {
  slack: WebClient;
  taskTitle: string;
  responsible: string;
  delegation: string;
  carbonCopies: string[];
};

function mention(userId: string) {
  return `<@${userId}>`;
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

async function openDmChannel(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("conversations.open returned no channel (DM)");
  return channelId;
}

async function openGroupDmChannel(slack: WebClient, userIds: string[]) {
  const users = userIds.join(",");
  const conv = await slack.conversations.open({ users });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("conversations.open returned no channel (MPIM)");
  return channelId;
}

function isMissingScopeError(e: any) {
  const msg = (e?.data?.error ?? e?.message ?? "").toString();
  return msg.includes("missing_scope") || msg.includes("not_allowed_token_type");
}

export async function notifyTaskCompleted(args: NotifyTaskCompletedArgs) {
  const { slack, taskTitle, responsible, delegation } = args;

  const ccUnique = uniq(args.carbonCopies ?? []);

  // participantes: responsável + delegador + CC
  let participants = uniq([responsible, delegation, ...ccUnique]);

  // remove IDs obviamente inválidos
  participants = participants.filter((u) => u.startsWith("U") || u.startsWith("W"));

  // tenta remover o próprio bot da lista (evita erro em alguns workspaces)
  try {
    const auth = await slack.auth.test();
    const botUserId = auth.user_id;
    if (botUserId) participants = participants.filter((u) => u !== botUserId);
  } catch {
    // se falhar, segue sem remover
  }

  const ccMentions = ccUnique.map(mention);

  const line1 = `✅ A tarefa *${taskTitle}* foi concluída.`;
  const line2 =
    ccMentions.length > 0
      ? `${mention(responsible)}, aqui você pode dar ou receber feedback de ${mention(
          delegation
        )}, com cópia para ${ccMentions.join(", ")}`
      : `${mention(responsible)}, aqui você pode dar ou receber feedback de ${mention(delegation)}.`;

  const text = `${line1}\n${line2}`;

  // Se só tem 1 pessoa, manda DM direto (não tenta MPIM)
  if (participants.length <= 1) {
    const only = participants[0];
    if (!only) return;
    const channelId = await openDmChannel(slack, only);
    await slack.chat.postMessage({ channel: channelId, text });
    return;
  }

  // ✅ tentativa: grupo DM (MPIM)
  try {
    const channelId = await openGroupDmChannel(slack, participants);
    await slack.chat.postMessage({ channel: channelId, text });
    return;
  } catch (e) {
    // fallback: DMs individuais
    console.error("[notifyTaskCompleted] openGroupDm failed:", e);

    // se for missing_scope, nem insiste no MPIM novamente
    if (isMissingScopeError(e)) {
      console.error("[notifyTaskCompleted] missing scope for MPIM. Using individual DMs.");
    }
  }

  // ✅ fallback: DMs individuais
  await Promise.allSettled(
    participants.map(async (uid) => {
      try {
        const channelId = await openDmChannel(slack, uid);
        await slack.chat.postMessage({ channel: channelId, text });
      } catch (e) {
        console.error("[notifyTaskCompleted] DM failed:", { uid, e });
      }
    })
  );
}
