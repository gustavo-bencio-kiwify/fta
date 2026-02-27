// src/utils/sortTasks.ts

type TaskLike = {
  urgency?: string | null;          // "turbo" | "asap" | "light"
  term?: Date | string | null;      // data (Date ou ISO)
  deadlineTime?: string | null;     // opcional: "HH:mm"
  createdAt?: Date | string | null; // opcional (para desempate estável)
  id?: string | null;              // opcional (para desempate final)
};

const URGENCY_RANK: Record<string, number> = {
  turbo: 0,
  asap: 1,
  light: 2,
};

function toTimeMs(t: TaskLike): number {
  // Sem data => vai pro final
  if (!t.term) return Number.POSITIVE_INFINITY;

  const d = typeof t.term === "string" ? new Date(t.term) : t.term;
  const base = d.getTime();
  if (Number.isNaN(base)) return Number.POSITIVE_INFINITY;

  // Se tiver hora (HH:mm), ordena dentro do mesmo dia
  if (t.deadlineTime && /^\d{2}:\d{2}$/.test(t.deadlineTime)) {
    const [hh, mm] = t.deadlineTime.split(":").map(Number);
    const dt = new Date(d);
    dt.setHours(hh, mm, 0, 0);
    return dt.getTime();
  }

  return base;
}

function toMs(v?: Date | string | null): number {
  if (!v) return Number.POSITIVE_INFINITY;
  const d = typeof v === "string" ? new Date(v) : v;
  const ms = d.getTime();
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
}

export function sortTasksByUrgencyThenDate<T extends TaskLike>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const ra = URGENCY_RANK[a.urgency ?? ""] ?? 99;
    const rb = URGENCY_RANK[b.urgency ?? ""] ?? 99;
    if (ra !== rb) return ra - rb;

    const da = toTimeMs(a);
    const db = toTimeMs(b);
    if (da !== db) return da - db;

    // desempate estável (se existir)
    const ca = toMs(a.createdAt ?? null);
    const cb = toMs(b.createdAt ?? null);
    if (ca !== cb) return ca - cb;

    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
}