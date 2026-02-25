// src/views/editTaskModal.ts
import type { View } from "@slack/web-api";

export const EDIT_TASK_MODAL_CALLBACK_ID = "edit_task_modal" as const;

export const EDIT_TITLE_BLOCK_ID = "edit_title_block" as const;
export const EDIT_TITLE_ACTION_ID = "edit_title" as const;

export const EDIT_DESC_BLOCK_ID = "edit_desc_block" as const;
export const EDIT_DESC_ACTION_ID = "edit_desc" as const;

export const EDIT_TERM_BLOCK_ID = "edit_term_block" as const;
export const EDIT_TERM_ACTION_ID = "edit_term" as const;

export const EDIT_TIME_BLOCK_ID = "edit_time_block" as const;
export const EDIT_TIME_ACTION_ID = "edit_time" as const;

export const EDIT_RESP_BLOCK_ID = "edit_resp_block" as const;
export const EDIT_RESP_ACTION_ID = "edit_resp" as const;

export const EDIT_CC_BLOCK_ID = "edit_cc_block" as const;
export const EDIT_CC_ACTION_ID = "edit_cc" as const;

// ✅ NOVO: Projeto
export const EDIT_PROJECT_BLOCK_ID = "edit_project_block" as const;
export const EDIT_PROJECT_ACTION_ID = "edit_project" as const;

export const EDIT_RECURRENCE_BLOCK_ID = "edit_recurrence_block" as const;
export const EDIT_RECURRENCE_ACTION_ID = "edit_recurrence" as const;

export const EDIT_URGENCY_BLOCK_ID = "edit_urgency_block" as const;
export const EDIT_URGENCY_ACTION_ID = "edit_urgency" as const;

export const EDIT_CAL_PRIVATE_BLOCK_ID = "edit_cal_private_block" as const;
export const EDIT_CAL_PRIVATE_ACTION_ID = "edit_cal_private_action" as const;

export type EditTaskProjectOption = {
  id: string;
  name: string;
};

type RecurrenceValue =
  | "none"
  | "daily"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "quarterly"
  | "semiannual"
  | "annual";

function recurrenceLabel(v: RecurrenceValue) {
  switch (v) {
    case "none":
      return "Sem recorrência";
    case "daily":
      return "Diária";
    case "weekly":
      return "Semanal";
    case "biweekly":
      return "Quinzenal";
    case "monthly":
      return "Mensal";
    case "quarterly":
      return "Trimestral";
    case "semiannual":
      return "Semestral";
    case "annual":
      return "Anual";
    default:
      return v;
  }
}

export function editTaskModalView(args: {
  taskId: string;

  title: string;
  description?: string | null;

  currentDateIso?: string | null; // YYYY-MM-DD
  currentTime?: string | null; // HH:MM

  responsibleSlackId: string;
  carbonCopiesSlackIds: string[];
  recurrence: string | null; // pode vir "none" ou null

  // ✅ NOVO: projeto atual + lista de projetos disponíveis
  currentProjectId?: string | null;
  projects?: EditTaskProjectOption[];

  urgency?: "light" | "asap" | "turbo" | string | null;
  calendarPrivate?: boolean;
}): View {
  const recurrenceInitial: RecurrenceValue =
    (args.recurrence as RecurrenceValue) && args.recurrence !== "null"
      ? (args.recurrence as RecurrenceValue)
      : "none";

  const recurrenceOptions: RecurrenceValue[] = [
    "none",
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "semiannual",
    "annual",
  ];

  const urgencyRaw = String((args.urgency as any) ?? "light").trim();
  const urgencyValue =
    urgencyRaw === "asap" || urgencyRaw === "turbo" || urgencyRaw === "light" ? urgencyRaw : "light";

  const urgencyLabel = (u: string) => {
    if (u === "turbo") return "🔴 Turbo";
    if (u === "asap") return "🟡 ASAP";
    return "🟢 Light";
  };

  // ✅ NOVO: bloco de projeto (com opção "Sem projeto" para permitir desvincular)
  const incomingProjects = Array.isArray(args.projects) ? args.projects : [];
  const uniqueProjects = Array.from(
    new Map(
      incomingProjects
        .filter((p) => p?.id && p?.name)
        .map((p) => [p.id, { id: p.id, name: p.name }])
    ).values()
  );

  const projectOptions = [
    { text: { type: "plain_text" as const, text: "Sem projeto" }, value: "none" },
    ...uniqueProjects.slice(0, 99).map((p) => ({
      text: { type: "plain_text" as const, text: p.name.slice(0, 75) },
      value: p.id,
    })),
  ];

  const selectedProjectOption =
    args.currentProjectId && projectOptions.some((o) => o.value === args.currentProjectId)
      ? projectOptions.find((o) => o.value === args.currentProjectId)
      : projectOptions[0];

  return {
    type: "modal",
    callback_id: EDIT_TASK_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({ taskId: args.taskId }),
    title: { type: "plain_text", text: "Editar tarefa" },
    submit: { type: "plain_text", text: "Salvar" },
    close: { type: "plain_text", text: "Cancelar" },
    blocks: [
      // Título
      {
        type: "input",
        block_id: EDIT_TITLE_BLOCK_ID,
        element: {
          type: "plain_text_input",
          action_id: EDIT_TITLE_ACTION_ID,
          initial_value: args.title ?? "",
        },
        label: { type: "plain_text", text: "Título" },
      },

      // Descrição
      {
        type: "input",
        optional: true,
        block_id: EDIT_DESC_BLOCK_ID,
        element: {
          type: "plain_text_input",
          action_id: EDIT_DESC_ACTION_ID,
          multiline: true,
          initial_value: args.description ?? "",
        },
        label: { type: "plain_text", text: "Descrição" },
      },

      // Prazo (data)
      {
        type: "input",
        optional: true,
        block_id: EDIT_TERM_BLOCK_ID,
        element: {
          type: "datepicker",
          action_id: EDIT_TERM_ACTION_ID,
          initial_date: args.currentDateIso ?? undefined,
          placeholder: { type: "plain_text", text: "Sem prazo" },
        },
        label: { type: "plain_text", text: "Prazo (data)" },
      },

      // Horário
      {
        type: "input",
        optional: true,
        block_id: EDIT_TIME_BLOCK_ID,
        element: {
          type: "timepicker",
          action_id: EDIT_TIME_ACTION_ID,
          initial_time: args.currentTime ?? undefined,
          placeholder: { type: "plain_text", text: "Sem horário" },
        },
        label: { type: "plain_text", text: "Horário (opcional)" },
      },

      // Responsável
      {
        type: "input",
        block_id: EDIT_RESP_BLOCK_ID,
        element: {
          type: "users_select",
          action_id: EDIT_RESP_ACTION_ID,
          initial_user: args.responsibleSlackId,
          placeholder: { type: "plain_text", text: "Selecione o responsável" },
        },
        label: { type: "plain_text", text: "Responsável" },
      },

      // Pessoas em cópia
      {
        type: "input",
        optional: true,
        block_id: EDIT_CC_BLOCK_ID,
        element: {
          type: "multi_users_select",
          action_id: EDIT_CC_ACTION_ID,
          initial_users: Array.from(new Set(args.carbonCopiesSlackIds ?? [])).filter(Boolean),
          placeholder: { type: "plain_text", text: "Selecione pessoas em cópia" },
        },
        label: { type: "plain_text", text: "Pessoas em cópia" },
      },

      // ✅ NOVO: Projeto
      {
        type: "input",
        optional: true,
        block_id: EDIT_PROJECT_BLOCK_ID,
        element: {
          type: "static_select",
          action_id: EDIT_PROJECT_ACTION_ID,
          placeholder: { type: "plain_text", text: "Selecione um projeto" },
          initial_option: selectedProjectOption,
          options: projectOptions,
        },
        label: { type: "plain_text", text: "Projeto" },
      },

      // Urgência
      {
        type: "input",
        block_id: EDIT_URGENCY_BLOCK_ID,
        element: {
          type: "static_select",
          action_id: EDIT_URGENCY_ACTION_ID,
          placeholder: { type: "plain_text", text: "Selecione" },
          initial_option: {
            text: { type: "plain_text", text: urgencyLabel(String(urgencyValue)) },
            value: String(urgencyValue),
          },
          options: [
            { text: { type: "plain_text", text: "🟢 Light" }, value: "light" },
            { text: { type: "plain_text", text: "🟡 ASAP" }, value: "asap" },
            { text: { type: "plain_text", text: "🔴 Turbo" }, value: "turbo" },
          ],
        },
        label: { type: "plain_text", text: "Nível de urgência" },
      },

      // Recorrência
      {
        type: "input",
        optional: true,
        block_id: EDIT_RECURRENCE_BLOCK_ID,
        element: {
          type: "static_select",
          action_id: EDIT_RECURRENCE_ACTION_ID,
          placeholder: { type: "plain_text", text: "Sem recorrência" },
          initial_option: {
            text: { type: "plain_text", text: recurrenceLabel(recurrenceInitial) },
            value: recurrenceInitial,
          },
          options: recurrenceOptions.map((v) => ({
            text: { type: "plain_text", text: recurrenceLabel(v) },
            value: v,
          })),
        },
        label: { type: "plain_text", text: "Recorrência" },
      },

      // Google Calendar: privado
      {
        type: "input",
        optional: true,
        block_id: EDIT_CAL_PRIVATE_BLOCK_ID,
        element: {
          type: "checkboxes",
          action_id: EDIT_CAL_PRIVATE_ACTION_ID,
          options: [
            {
              text: { type: "plain_text", text: "🔒 Deixar evento privado" },
              value: "private",
            },
          ],
          initial_options: args.calendarPrivate
            ? [
                {
                  text: { type: "plain_text", text: "🔒 Deixar evento privado" },
                  value: "private",
                },
              ]
            : undefined,
        },
        label: { type: "plain_text", text: "Google Calendar" },
      },
    ],
  };
}