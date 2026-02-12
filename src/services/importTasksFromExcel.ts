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

function normalizeHeader(s: string) {
    return s
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "_");
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
    const m = s.match(/^<@([A-Z0-9]+)>$/i);
    if (m?.[1]) return m[1];
    if (/^[A-Z0-9]{8,}$/.test(s)) return s;
    return null;
}

function parseDateToTermDate(value: any): Date | null {
    // aceita Date, "dd/mm/yyyy", "yyyy-mm-dd"
    if (!value) return null;

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const y = value.getFullYear();
        const m = value.getMonth() + 1;
        const d = value.getDate();
        const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        return new Date(`${iso}T03:00:00.000Z`); // 00:00 SP => 03:00Z
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

function parseTime(s: string): string | null {
    const t = s.trim();
    if (!t) return null;
    if (/^\d{2}:\d{2}$/.test(t)) return t;
    return null;
}

function parseUrgency(s: string): "light" | "asap" | "turbo" {
    const v = s.trim().toLowerCase();
    if (v === "turbo") return "turbo";
    if (v === "asap") return "asap";
    return "light";
}

function parseRecurrence(s: string): string | null {
    const v = s.trim().toLowerCase();
    if (!v || v === "none" || v === "nenhuma") return null;
    if (["daily", "weekly", "monthly"].includes(v)) return v;
    return null;
}

function parseCcList(s: string): string[] {
    if (!s?.trim()) return [];
    return Array.from(
        new Set(
            s
                .split(",")
                .map((x) => parseSlackUserId(x) ?? "")
                .filter(Boolean)
        )
    );
}

async function downloadSlackFileToBuffer(file: SlackFile): Promise<Buffer<ArrayBuffer>> {
    const token = mustEnv("SLACK_BOT_TOKEN");
    const url = file.url_private_download || file.url_private;
    if (!url) throw new Error("Slack file missing url_private_download/url_private");

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed to download slack file: ${res.status} ${res.statusText}`);

    const arr = await res.arrayBuffer(); // ArrayBuffer
    return Buffer.from(arr);             // Buffer<ArrayBuffer>
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

    // mapeia headers
    const headerRow = ws.getRow(1);
    const colIndexByKey: Record<string, number> = {};

    headerRow.eachCell((cell, colNumber) => {
        const h = normalizeHeader(cellToString(cell.value));
        if (!h) return;

        // aceita variações
        if (["titulo", "title"].includes(h)) colIndexByKey.title = colNumber;
        if (["descricao", "description"].includes(h)) colIndexByKey.description = colNumber;
        if (["responsavel", "responsible"].includes(h)) colIndexByKey.responsible = colNumber;
        if (["prazo", "due", "due_date", "data"].includes(h)) colIndexByKey.term = colNumber;
        if (["horario", "hora", "time"].includes(h)) colIndexByKey.deadlineTime = colNumber;
        if (["urgencia", "urgency"].includes(h)) colIndexByKey.urgency = colNumber;
        if (["copias", "cc", "carbon_copies"].includes(h)) colIndexByKey.cc = colNumber;
        if (["recorrencia", "recurrence"].includes(h)) colIndexByKey.recurrence = colNumber;
        if (["projeto", "project"].includes(h)) colIndexByKey.project = colNumber;
        if (["depende_de", "depends_on", "depends"].includes(h)) colIndexByKey.dependsOnId = colNumber;
    });

    if (!colIndexByKey.title || !colIndexByKey.responsible) {
        await slack.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: "⛔ O arquivo precisa ter pelo menos as colunas: *Titulo* e *Responsavel* (linha 1).",
        });
        return;
    }

    const created: string[] = [];
    const failed: Array<{ row: number; reason: string }> = [];

    // processa linhas
    for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);

        const title = cellToString(row.getCell(colIndexByKey.title).value);
        if (!title) continue; // linha vazia => ignora

        const responsibleRaw = cellToString(row.getCell(colIndexByKey.responsible).value);
        const responsible = parseSlackUserId(responsibleRaw);
        if (!responsible) {
            failed.push({ row: r, reason: `Responsavel inválido: "${responsibleRaw}"` });
            continue;
        }

        const description = colIndexByKey.description
            ? (cellToString(row.getCell(colIndexByKey.description).value) || null)
            : null;

        const term = colIndexByKey.term ? parseDateToTermDate(row.getCell(colIndexByKey.term).value) : null;

        const deadlineTime = colIndexByKey.deadlineTime
            ? parseTime(cellToString(row.getCell(colIndexByKey.deadlineTime).value))
            : null;

        const urgency = colIndexByKey.urgency
            ? parseUrgency(cellToString(row.getCell(colIndexByKey.urgency).value))
            : "light";

        const carbonCopies = colIndexByKey.cc
            ? parseCcList(cellToString(row.getCell(colIndexByKey.cc).value))
            : [];

        const recurrence = colIndexByKey.recurrence
            ? parseRecurrence(cellToString(row.getCell(colIndexByKey.recurrence).value))
            : null;

        const dependsOnIdRaw = colIndexByKey.dependsOnId
            ? cellToString(row.getCell(colIndexByKey.dependsOnId).value)
            : "";
        const dependsOnId = dependsOnIdRaw && isUuid(dependsOnIdRaw) ? dependsOnIdRaw : null;

        // projeto: aceita UUID ou nome exato
        let projectId: string | null = null;
        if (colIndexByKey.project) {
            const p = cellToString(row.getCell(colIndexByKey.project).value);
            if (p) {
                if (isUuid(p)) {
                    const ok = await prisma.project.findFirst({
                        where: { id: p, status: "active", members: { some: { slackUserId: uploadedBySlackId } } },
                        select: { id: true },
                    });
                    projectId = ok?.id ?? null;
                } else {
                    const ok = await prisma.project.findFirst({
                        where: {
                            status: "active",
                            name: { equals: p, mode: "insensitive" as any },
                            members: { some: { slackUserId: uploadedBySlackId } },
                        },
                        select: { id: true },
                    });
                    projectId = ok?.id ?? null;
                }
            }
        }

        try {
            const task = await createTaskService({
                title,
                description: description?.trim() ? description : undefined,
                delegation: uploadedBySlackId,
                responsible,
                term,
                deadlineTime,
                recurrence,
                projectId,
                dependsOnId,
                urgency,
                carbonCopies,
            });

            // emails + calendar (não deixa falhar o import)
            try {
                await syncTaskParticipantEmails({
                    slack,
                    taskId: task.id,
                    delegationSlackId: uploadedBySlackId,
                    responsibleSlackId: task.responsible,
                    carbonCopiesSlackIds: task.carbonCopies.map((c) => c.slackUserId),
                });
            } catch { }

            try {
                await syncCalendarEventForTask(task.id);
            } catch { }

            // se depende de outra task ainda não concluída, pode adiar notify (igual você já faz)
            let deferNotifyCreated = false;
            if (dependsOnId) {
                const dep = await prisma.task.findUnique({ where: { id: dependsOnId }, select: { status: true } });
                deferNotifyCreated = dep?.status !== "done";
            }

            if (!deferNotifyCreated) {
                await notifyTaskCreated({
                    slack,
                    taskId: task.id,
                    createdBy: uploadedBySlackId,
                    taskTitle: task.title,
                    responsible: task.responsible,
                    carbonCopies: task.carbonCopies.map((c) => c.slackUserId),
                    term: task.term,
                    deadlineTime: (task as any).deadlineTime ?? null,
                });
            }

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
