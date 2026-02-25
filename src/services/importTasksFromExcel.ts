// src/services/importTasksFromExcel.ts
import type { WebClient } from "@slack/web-api";
import ExcelJS from "exceljs";
import { prisma } from "../lib/prisma";
import { createTaskService } from "./createTaskService";
import { notifyTaskCreated } from "./notifyTaskCreated";
import { syncCalendarEventForTask } from "./googleCalendar";
import { syncTaskParticipantEmails } from "./syncTaskParticipantEmails";

type SlackFile = {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private_download?: string;
  url_private?: string;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// ✅ normaliza para bater com: "titulo", "e_mail_do_responsavel", "id_slack_do_responsavel", etc.
function normalizeHeader(s: string) {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\*/g, "")              // remove "*"
    .replace(/[^a-z0-9]+/g, "_")     // tudo que não é letra/número vira "_"
    .replace(/^_+|_+$/g, "");        // trim underscores
}

function cellToString(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && typeof v.text === "string") return v.text.trim(); // rich text
  return String(v).trim();
}

function parseSlackUserId(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // <@U123>
  const m = s.match(/^<@([A-Z0-9]+)>$/i);
  if (m?.[1]) return m[1];

  // U123...
  if (/^[A-Z0-9]{8,}$/.test(s)) return s;

  return null;
}

function parseEmail(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  // simples e suficiente pro caso
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
  return null;
}

async function slackUserIdFromEmail(slack: WebClient, email: string): Promise<string | null> {
  try {
    const res = await slack.users.lookupByEmail({ email });
    const id = (res.user as any)?.id as string | undefined;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

function parseDateToTermDate(value: any): Date | null {
  // aceita Date, Excel serial, "dd/mm/yyyy", "yyyy-mm-dd"
  if (!value) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString().slice(0, 10);
    return new Date(`${iso}T03:00:00.000Z`); // 00:00 SP => 03:00Z
  }

  // Excel serial date (ex: 45567)
  if (typeof value === "number" && value > 20000) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const iso = d.toISOString().slice(0, 10);
      return new Date(`${iso}T03:00:00.000Z`);
    }
  }

  const s = cellToString(value);
  if (!s) return null;

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T03:00:00.000Z`);

  // dd/mm/yyyy
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    return new Date(`${iso}T03:00:00.000Z`);
  }

  return null;
}

function parseTime(value: any): string | null {
  if (value == null) return null;

  // se vier como Date, pega HH:MM
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hh = String(value.getHours()).padStart(2, "0");
    const mm = String(value.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // Excel time fraction (0..1)
  if (typeof value === "number" && value >= 0 && value < 1) {
    const totalMin = Math.round(value * 24 * 60);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const t = cellToString(value);
  if (!t) return null;
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  return null;
}

function parseUrgency(s: string): "light" | "asap" | "turbo" {
  const v = s.trim().toLowerCase();
  if (v.includes("turbo")) return "turbo";
  if (v.includes("asap")) return "asap";
  return "light";
}

function parseRecurrence(s: string): string | null {
  const v = s.trim().toLowerCase();
  if (!v || v === "none" || v === "nenhuma") return null;
  if (v === "diaria" || v === "diária" || v === "daily") return "daily";
  if (v === "semanal" || v === "weekly") return "weekly";
  if (v === "mensal" || v === "monthly") return "monthly";
  if (["daily", "weekly", "monthly"].includes(v)) return v;
  return null;
}

function parseSlackIdsList(raw: string): string[] {
  if (!raw?.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((x) => parseSlackUserId(x) ?? "")
        .filter(Boolean)
    )
  );
}

function parseEmailsList(raw: string): string[] {
  if (!raw?.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((x) => parseEmail(x) ?? "")
        .filter(Boolean)
    )
  );
}

async function downloadSlackFileToBuffer(file: SlackFile): Promise<Buffer> {
  const token = mustEnv("SLACK_BOT_TOKEN");
  const url = file.url_private_download || file.url_private;
  if (!url) throw new Error("Slack file missing url_private_download/url_private");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to download slack file: ${res.status} ${res.statusText}`);

  const ab = await res.arrayBuffer();
  return Buffer.from(new Uint8Array(ab)); // ✅ Buffer “puro” (evita treta de typing)
}

export async function importTasksFromExcelSlackFile(args: {
  slack: WebClient;
  uploadedBySlackId: string;
  channelId: string;
  threadTs: string;
  file: SlackFile;
}) {
  const { slack, uploadedBySlackId, channelId, threadTs, file } = args;

  await slack.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `📥 Recebi o arquivo *${file.name ?? "tasks.xlsx"}*. Vou processar agora…`,
  });

  const buf = await downloadSlackFileToBuffer(file);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);

  const ws = wb.worksheets[0];
  if (!ws) {
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: "⛔ Não encontrei nenhuma aba no arquivo.",
    });
    return;
  }

  type Cols = {
    title?: number;
    description?: number;
    responsibleEmail?: number;
    responsibleSlackId?: number;

    // ✅ NOVO: delegador por linha (fallback = uploadedBySlackId)
    delegationSlackId?: number;

    term?: number;
    deadlineTime?: number;
    urgency?: number;
    recurrence?: number;
    projectName?: number;
    projectId?: number;
    ccEmails?: number;
    ccSlackIds?: number;
  };

  const cols: Cols = {};

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    const h = normalizeHeader(cellToString(cell.value));
    if (!h) return;

    if (["titulo", "title"].includes(h)) cols.title = colNumber;
    if (["descricao", "description"].includes(h)) cols.description = colNumber;

    if (["e_mail_do_responsavel", "email_do_responsavel", "responsible_email"].includes(h)) {
      cols.responsibleEmail = colNumber;
    }

    if (["id_slack_do_responsavel", "responsible_slack_id", "responsavel_slack_id"].includes(h)) {
      cols.responsibleSlackId = colNumber;
    }

    // ✅ NOVO: "ID Slack de quem delegou"
    if (
      [
        "id_slack_de_quem_delegou",
        "id_slack_do_delegador",
        "id_slack_delegador",
        "delegation_slack_id",
        "delegator_slack_id",
      ].includes(h)
    ) {
      cols.delegationSlackId = colNumber;
    }

    if (["prazo", "due_date", "due"].includes(h)) cols.term = colNumber;
    if (["horario", "hora", "due_time", "time"].includes(h)) cols.deadlineTime = colNumber;

    if (["urgencia", "urgency"].includes(h)) cols.urgency = colNumber;
    if (["recorrencia", "recurrence"].includes(h)) cols.recurrence = colNumber;

    if (["nome_do_projeto", "project_name"].includes(h)) cols.projectName = colNumber;
    if (["id_projeto", "project_id"].includes(h)) cols.projectId = colNumber;

    if (["e_mail_das_copias", "email_das_copias", "cc_emails"].includes(h)) cols.ccEmails = colNumber;
    if (["id_slack_das_copias", "cc_slack_ids"].includes(h)) cols.ccSlackIds = colNumber;
  });

  // ✅ Regras do template:
  // - obrigatórios: Título*, Prazo*, Urgência*
  // - responsável: precisa existir pelo menos UMA coluna (E-mail OU ID Slack)
  if (!cols.title || !cols.term || !cols.urgency || (!cols.responsibleEmail && !cols.responsibleSlackId)) {
    await slack.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text:
        "⛔ Headers inválidos.\n" +
        "O arquivo precisa ter obrigatoriamente (linha 1):\n" +
        "• *Título**\n" +
        "• *Prazo**\n" +
        "• *Urgência**\n" +
        "• *E-mail do responsável* **OU** *ID Slack do responsável*\n\n" +
        "E opcionalmente:\n" +
        "Descrição, Horário, Recorrência, Nome do Projeto, ID Projeto, E-mail das cópias, ID Slack das cópias.",
    });
    return;
  }

  const created: string[] = [];
  const failed: Array<{ row: number; reason: string }> = [];

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);

    const title = cellToString(row.getCell(cols.title).value);
    if (!title) continue; // linha vazia

    // ✅ Responsável: aceita E-mail OU ID Slack (ou ambos)
    const responsibleEmailRaw = cols.responsibleEmail
      ? cellToString(row.getCell(cols.responsibleEmail).value)
      : "";

    const responsibleSlackIdRaw = cols.responsibleSlackId
      ? cellToString(row.getCell(cols.responsibleSlackId).value)
      : "";

    const responsibleEmail = responsibleEmailRaw ? parseEmail(responsibleEmailRaw) : null;
    let responsibleSlackId = responsibleSlackIdRaw ? parseSlackUserId(responsibleSlackIdRaw) : null;

    // Se nenhum dos dois foi informado/parseado, falha
    if (!responsibleEmail && !responsibleSlackId) {
      failed.push({
        row: r,
        reason:
          `Informe um responsável válido por E-mail ou ID Slack ` +
          `(email="${responsibleEmailRaw || ""}", slackId="${responsibleSlackIdRaw || ""}")`,
      });
      continue;
    }

    // Se veio e-mail mas não veio Slack ID válido, tenta resolver pelo Slack
    if (!responsibleSlackId && responsibleEmail) {
      responsibleSlackId = await slackUserIdFromEmail(slack, responsibleEmail);
    }

    if (!responsibleSlackId) {
      if (responsibleEmail) {
        failed.push({
          row: r,
          reason: `Não consegui achar o Slack ID do responsável pelo e-mail: "${responsibleEmail}"`,
        });
      } else {
        failed.push({
          row: r,
          reason: `ID Slack do responsável inválido: "${responsibleSlackIdRaw}"`,
        });
      }
      continue;
    }

    // ✅ NOVO: delegador por linha (fallback = quem enviou o arquivo)
    let delegationSlackId = uploadedBySlackId;

    if (cols.delegationSlackId) {
      const delegationRaw = cellToString(row.getCell(cols.delegationSlackId).value);

      if (delegationRaw) {
        const parsedDelegation = parseSlackUserId(delegationRaw);

        if (!parsedDelegation) {
          failed.push({
            row: r,
            reason: `ID Slack de quem delegou inválido: "${delegationRaw}"`,
          });
          continue;
        }

        delegationSlackId = parsedDelegation;
      }
    }

    const description = cols.description
      ? (cellToString(row.getCell(cols.description).value) || null)
      : null;

    const term = parseDateToTermDate(row.getCell(cols.term).value);
    if (!term) {
      failed.push({ row: r, reason: `Prazo inválido (use data válida): "${cellToString(row.getCell(cols.term).value)}"` });
      continue;
    }

    const deadlineTime = cols.deadlineTime ? parseTime(row.getCell(cols.deadlineTime).value) : null;

    const urgencyRaw = cellToString(row.getCell(cols.urgency).value);
    const urgency = parseUrgency(urgencyRaw);

    const recurrence = cols.recurrence ? parseRecurrence(cellToString(row.getCell(cols.recurrence).value)) : null;

    // CCs: junta slack ids + emails (resolvendo email -> slack)
    const ccSlackIds = cols.ccSlackIds ? parseSlackIdsList(cellToString(row.getCell(cols.ccSlackIds).value)) : [];
    const ccEmails = cols.ccEmails ? parseEmailsList(cellToString(row.getCell(cols.ccEmails).value)) : [];

    const ccFromEmails = await Promise.all(ccEmails.map((em) => slackUserIdFromEmail(slack, em)));
    const carbonCopies = Array.from(
      new Set([...ccSlackIds, ...ccFromEmails.filter(Boolean)].filter((x): x is string => Boolean(x)))
    ).filter((id) => id !== responsibleSlackId);

    // Projeto: por ID (uuid) ou Nome (exato)
    // ✅ Agora valida acesso considerando uploader OU delegador da linha
    let projectId: string | null = null;

    const projectIdRaw = cols.projectId ? cellToString(row.getCell(cols.projectId).value) : "";
    const projectNameRaw = cols.projectName ? cellToString(row.getCell(cols.projectName).value) : "";

    const projectAccessUserIds = Array.from(new Set([uploadedBySlackId, delegationSlackId].filter(Boolean)));

    if (projectIdRaw && isUuid(projectIdRaw)) {
      const ok = await prisma.project.findFirst({
        where: {
          id: projectIdRaw,
          status: "active",
          OR: [
            { createdBySlackId: { in: projectAccessUserIds } },
            { members: { some: { slackUserId: { in: projectAccessUserIds } } } },
          ],
        },
        select: { id: true },
      });
      projectId = ok?.id ?? null;
    } else if (projectNameRaw) {
      const ok = await prisma.project.findFirst({
        where: {
          status: "active",
          name: { equals: projectNameRaw, mode: "insensitive" as any },
          OR: [
            { createdBySlackId: { in: projectAccessUserIds } },
            { members: { some: { slackUserId: { in: projectAccessUserIds } } } },
          ],
        },
        select: { id: true },
      });
      projectId = ok?.id ?? null;
    }

    try {
      const task = await createTaskService({
        title,
        description: description?.trim() ? description : undefined,
        delegation: delegationSlackId, // ✅ usa delegador da linha (ou fallback)
        responsible: responsibleSlackId,
        term,
        deadlineTime,
        recurrence,
        projectId,
        dependsOnId: null, // ✅ removido do template
        urgency,
        carbonCopies,
      });

      // emails + calendar (não deixa falhar o import)
      try {
        await syncTaskParticipantEmails({
          slack,
          taskId: task.id,
          delegationSlackId, // ✅ usa delegador da linha
          responsibleSlackId: task.responsible,
          carbonCopiesSlackIds: task.carbonCopies.map((c) => c.slackUserId),
        });
      } catch { }

      try {
        await syncCalendarEventForTask(task.id);
      } catch { }

      await notifyTaskCreated({
        slack,
        taskId: task.id,
        createdBy: delegationSlackId, // ✅ notificação mostra o delegador correto
        taskTitle: task.title,
        responsible: task.responsible,
        carbonCopies: task.carbonCopies.map((c) => c.slackUserId),
        term: task.term,
        deadlineTime: (task as any).deadlineTime ?? null,
      });

      created.push(task.id);
    } catch (e: any) {
      failed.push({ row: r, reason: e?.message ?? "erro ao criar" });
    }
  }

  const okMsg = created.length ? `✅ Criei *${created.length}* tarefa(s).` : "⚠️ Não criei nenhuma tarefa.";
  const failMsg = failed.length
    ? `\n\n⛔ Falhas (${failed.length}):\n` +
    failed.slice(0, 10).map((f) => `• Linha ${f.row}: ${f.reason}`).join("\n") +
    (failed.length > 10 ? `\n… +${failed.length - 10} outras` : "")
    : "";

  await slack.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: okMsg + failMsg,
  });
}