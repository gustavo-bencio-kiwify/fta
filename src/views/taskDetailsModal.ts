// src/views/taskDetailsModal.ts
import type { View } from "@slack/web-api";

export const TASK_DETAILS_MODAL_TITLE = "Detalhes da Tarefa" as const;

type Urgency = "light" | "asap" | "turbo";

function urgencyLabel(u: Urgency) {
  if (u === "light") return "🟢 LIGHT";
  if (u === "asap") return "🟡 ASAP";
  return "🔴 TURBO";
}

function formatDateBRFromIso(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR");
}

export function taskDetailsModalView(args: {
  title: string;
  responsibleSlackId: string;
  delegationSlackId: string | null;
  dueDateIso: string | null; // YYYY-MM-DD
  deadlineTime: string | null; // HH:MM
  urgency: Urgency;
  recurrence: string | null;
  projectNameOrId: string | null;
  description: string | null;
}): View {
  const dueBr = formatDateBRFromIso(args.dueDateIso);
  const dueText = dueBr ? (args.deadlineTime ? `${dueBr} às ${args.deadlineTime}` : dueBr) : "Sem prazo";

  const delegatedText = args.delegationSlackId ? `<@${args.delegationSlackId}>` : "—";
  const projectText = args.projectNameOrId ?? "—";
  const recurrenceText = args.recurrence ?? "—";

  const blocks: View["blocks"] = [
    { type: "section", text: { type: "mrkdwn", text: `🔎 *${TASK_DETAILS_MODAL_TITLE}*` } },
    { type: "section", text: { type: "mrkdwn", text: `📌 *${args.title}*` } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Responsável:*\n<@${args.responsibleSlackId}>` },
        { type: "mrkdwn", text: `*Delegado por:*\n${delegatedText}` },
        { type: "mrkdwn", text: `*Prazo:*\n${dueText}` },
        { type: "mrkdwn", text: `*Urgência:*\n${urgencyLabel(args.urgency)}` },
        { type: "mrkdwn", text: `*Recorrência:*\n${recurrenceText}` },
        { type: "mrkdwn", text: `*Projeto:*\n${projectText}` },
      ],
    },
  ];

  if (args.description?.trim()) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `📝 *Descrição:*\n${args.description.trim()}` },
    });
  }

  return {
    type: "modal",
    title: { type: "plain_text", text: TASK_DETAILS_MODAL_TITLE },
    close: { type: "plain_text", text: "Fechar" },
    blocks,
  };
}
