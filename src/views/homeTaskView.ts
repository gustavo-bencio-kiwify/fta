import type { HomeView, AnyBlock } from "@slack/web-api";

type Urgency = "light" | "asap" | "turbo";

type TaskItem = {
  id: string;
  title: string;
  description?: string | null;
  term?: Date | null;          // prazo
  urgency: Urgency;
  delegation: string;          // quem delegou (slack user id)
};

function urgencyDot(u: Urgency) {
  if (u === "turbo") return "🔴";
  if (u === "asap") return "🟡";
  return "🟢";
}

function formatDateBR(d: Date) {
  // dd/MM/yyyy
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function truncate(text: string, max = 120) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function sectionTitle(text: string): AnyBlock {
  return {
    type: "section",
    text: { type: "mrkdwn", text },
  };
}

function taskLine(t: TaskItem): AnyBlock[] {
  const due = t.term ? formatDateBR(t.term) : "sem prazo";
  const dot = urgencyDot(t.urgency);

  const header = `☐ ${dot} *${t.title}* (vence ${due}) — _delegado por <@${t.delegation}>_`;
  const desc = t.description ? truncate(t.description) : undefined;

  const blocks: AnyBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: header },
    },
  ];

  if (desc) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: desc }],
    });
  }

  return blocks;
}

export function homeTasksView(params: {
  tasksToday: TaskItem[];
  tasksTomorrow: TaskItem[];
  tasksFuture: TaskItem[];
}): HomeView {
  const blocks: AnyBlock[] = [];

  blocks.push(sectionTitle("📌 *Suas tarefas (você é responsável)*"));
  blocks.push({ type: "divider" });

  // HOJE
  blocks.push(sectionTitle("*Hoje:*"));
  if (params.tasksToday.length === 0) {
    blocks.push(sectionTitle("_Nenhuma_"));
  } else {
    params.tasksToday.forEach((t) => blocks.push(...taskLine(t)));
  }

  blocks.push({ type: "divider" });

  // AMANHÃ
  blocks.push(sectionTitle("*Amanhã:*"));
  if (params.tasksTomorrow.length === 0) {
    blocks.push(sectionTitle("_Nenhuma_"));
  } else {
    params.tasksTomorrow.forEach((t) => blocks.push(...taskLine(t)));
  }

  blocks.push({ type: "divider" });

  // FUTURAS
  blocks.push(sectionTitle("*Futuras:*"));
  if (params.tasksFuture.length === 0) {
    blocks.push(sectionTitle("_Nenhuma_"));
  } else {
    params.tasksFuture.forEach((t) => blocks.push(...taskLine(t)));
  }

  return {
    type: "home",
    blocks,
  };
}
