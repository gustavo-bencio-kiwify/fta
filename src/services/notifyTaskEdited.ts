// src/services/notifyTaskEdited.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

type NotifyTaskEditedArgs = {
  slack: WebClient;
  taskId: string;

  editedBy: string; // quem editou (delegador)
  responsible: string; // responsável atual (depois da edição)

  // participantes (CC final). Pode ser união before+after.
  carbonCopies: string[];

  // BEFORE/AFTER (todos opcionais, mas quanto mais você passar, melhor o diff)
  oldTitle?: string | null;
  newTitle?: string | null;

  oldTerm?: Date | string | null; // Date do Prisma ou "YYYY-MM-DD"
  newTerm?: Date | string | null;

  oldDeadlineTime?: string | null; // "HH:MM"
  newDeadlineTime?: string | null;

  oldResponsible?: string | null;
  newResponsible?: string | null;

  oldRecurrence?: string | null;
  newRecurrence?: string | null;

  oldUrgency?: string | null;
  newUrgency?: string | null;

  oldCalendarPrivate?: boolean | null;
  newCalendarPrivate?: boolean | null;

  oldCarbonCopies?: string[] | null;
  newCarbonCopies?: string[] | null;
};

function mention(userId: string) {
  return `<@${userId}>`;
}

function uniq(arr: Array<string | null | undefined>) {
  return Array.from(new Set((arr ?? []).map((x) => (x ?? "").trim()).filter(Boolean)));
}

function termToIso(term?: Date | string | null) {
  if (!term) return null;

  if (typeof term === "string") {
    // "YYYY-MM-DD"
    if (/^\d{4}-\d{2}-\d{2}$/.test(term)) return term;

    // ISO completo
    const dt = new Date(term);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);

    return null;
  }

  if (term instanceof Date && !Number.isNaN(term.getTime())) {
    return term.toISOString().slice(0, 10);
  }

  return null;
}

function formatDateBrFromIso(iso: string) {
  // ✅ interpreta como 00:00 SP
  const d = new Date(`${iso}T03:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(d);
}

function formatDue(term?: Date | string | null, time?: string | null) {
  const iso = termToIso(term);
  if (!iso) return "sem prazo";
  const ddmmyyyy = formatDateBrFromIso(iso);
  const hhmm = (time ?? "").trim();
  return hhmm ? `${ddmmyyyy} às ${hhmm}` : ddmmyyyy;
}

function urgencyLabel(u?: string | null) {
  if (u === "turbo") return "🔴 Turbo";
  if (u === "asap") return "🟡 ASAP";
  return "🟢 Light";
}

function calVisibilityLabel(privateFlag?: boolean | null) {
  return privateFlag ? "🔒 Privado" : "🌐 Padrão";
}

function sameString(a?: string | null, b?: string | null) {
  return (a ?? "").trim() === (b ?? "").trim();
}

function sameArray(a?: string[] | null, b?: string[] | null) {
  const aa = uniq(a ?? []).sort();
  const bb = uniq(b ?? []).sort();
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return false;
  return true;
}

async function openDmOrMpim(slack: WebClient, userIds: string[]) {
  const users = uniq(userIds).join(",");
  const conv = await slack.conversations.open({ users });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("conversations.open returned no channel id");
  return channelId;
}

async function postRootAndThread(args: {
  slack: WebClient;
  channel: string;
  rootText: string;
  threadText: string;
}) {
  const root = await args.slack.chat.postMessage({
    channel: args.channel,
    text: args.rootText,
  });

  const threadTs = (root as any)?.ts as string | undefined;
  if (!threadTs) return;

  await args.slack.chat.postMessage({
    channel: args.channel,
    thread_ts: threadTs,
    text: args.threadText,
  });
}

/**
 * ✅ Carimbo na thread da mensagem de criação da task (salva em Task.slackOpenChannelId/Task.slackOpenMessageTs)
 */
async function postStampInOpenThread(args: { slack: WebClient; taskId: string; editedBy: string }) {
  const { slack, taskId, editedBy } = args;

  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      slackOpenChannelId: true,
      slackOpenMessageTs: true,
    },
  });

  const channelId = t?.slackOpenChannelId ?? null;
  const threadTs = t?.slackOpenMessageTs ?? null;
  if (!channelId || !threadTs) return;

  await slack.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `✏️ Tarefa editada por ${mention(editedBy)}`,
  });
}

export async function notifyTaskEdited(args: NotifyTaskEditedArgs) {
  const {
    slack,
    taskId,
    editedBy,
    responsible,
    carbonCopies,

    oldTitle,
    newTitle,
    oldTerm,
    newTerm,
    oldDeadlineTime,
    newDeadlineTime,
    oldResponsible,
    newResponsible,
    oldRecurrence,
    newRecurrence,

    oldUrgency,
    newUrgency,

    oldCalendarPrivate,
    newCalendarPrivate,

    oldCarbonCopies,
    newCarbonCopies,
  } = args;

  const afterResponsible = (newResponsible ?? responsible ?? "").trim();
  const participants = uniq([editedBy, afterResponsible, ...(carbonCopies ?? [])]);

  const title = (newTitle ?? oldTitle ?? "tarefa").trim() || "tarefa";

  // Mensagem principal (raiz)
  const rootText = `${mention(editedBy)} editou a tarefa *${title}*`;

  // Thread: só o que mudou
  const changes: string[] = [];

  if (!sameString(oldTitle ?? null, newTitle ?? null) && (oldTitle || newTitle)) {
    changes.push(`• *Título:* ${oldTitle ?? "_vazio_"} → ${newTitle ?? "_vazio_"}`);
  }

  const oldDue = formatDue(oldTerm ?? null, oldDeadlineTime ?? null);
  const newDue = formatDue(newTerm ?? null, newDeadlineTime ?? null);
  if (oldDue !== newDue) {
    changes.push(`• *Prazo:* ${oldDue} → ${newDue}`);
  }

  if ((oldResponsible || newResponsible) && oldResponsible !== newResponsible) {
    const from = oldResponsible ? mention(oldResponsible) : "_vazio_";
    const to = newResponsible ? mention(newResponsible) : "_vazio_";
    changes.push(`• *Responsável:* ${from} → ${to}`);
  }

  if ((oldRecurrence || newRecurrence) && oldRecurrence !== newRecurrence) {
    changes.push(`• *Recorrência:* ${oldRecurrence ?? "_nenhuma_"} → ${newRecurrence ?? "_nenhuma_"}`);
  }

  if ((oldUrgency || newUrgency) && oldUrgency !== newUrgency) {
    changes.push(`• *Urgência:* ${urgencyLabel(oldUrgency ?? null)} → ${urgencyLabel(newUrgency ?? null)}`);
  }

  if (
    oldCalendarPrivate !== undefined &&
    newCalendarPrivate !== undefined &&
    Boolean(oldCalendarPrivate) !== Boolean(newCalendarPrivate)
  ) {
    changes.push(
      `• *Google Calendar:* ${calVisibilityLabel(Boolean(oldCalendarPrivate))} → ${calVisibilityLabel(
        Boolean(newCalendarPrivate)
      )}`
    );
  }

  if (!sameArray(oldCarbonCopies ?? null, newCarbonCopies ?? null) && (oldCarbonCopies || newCarbonCopies)) {
    const from = uniq(oldCarbonCopies ?? []).map(mention).join(", ") || "_nenhuma_";
    const to = uniq(newCarbonCopies ?? []).map(mention).join(", ") || "_nenhuma_";
    changes.push(`• *Cópias:* ${from} → ${to}`);
  }

  const changesText = changes.length ? changes.join("\n") : "• Nenhuma alteração detectada.";

  const threadText =
    `${mention(afterResponsible)}, ${mention(editedBy)} realizou as seguintes alterações:\n\n` + `${changesText}`;

  // ✅ 0) sempre tenta carimbar na thread da mensagem de criação (best-effort)
  void postStampInOpenThread({ slack, taskId, editedBy }).catch(() => {});

  // 1) tenta DM em grupo (MPIM) com thread
  try {
    const channel = await openDmOrMpim(slack, participants);
    await postRootAndThread({ slack, channel, rootText, threadText });
    return;
  } catch {
    // 2) fallback: DM individual pra cada envolvido (cada um com root + thread)
    await Promise.allSettled(
      participants.map(async (uid) => {
        const channel = await openDmOrMpim(slack, [uid]);
        await postRootAndThread({ slack, channel, rootText, threadText });
      })
    );
  }
}
