// src/services/createNextRecurringTaskFromCompleted.ts
import { prisma } from "../lib/prisma";
import { Recurrence } from "../generated/prisma/enums";

function daysInMonthUtc(year: number, month0: number) {
  // month0: 0..11
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

function addMonthsKeepDayUtc(base: Date, monthsToAdd: number) {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();

  const targetMonthIndex = m + monthsToAdd;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth0 = ((targetMonthIndex % 12) + 12) % 12;

  const dim = daysInMonthUtc(targetYear, targetMonth0);
  const day = Math.min(d, dim); // ✅ regra 1 (último dia do mês)
  return new Date(Date.UTC(targetYear, targetMonth0, day));
}

function addDaysUtc(base: Date, days: number) {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function computeNextAnchor(anchor: Date, recurrence: Recurrence): Date | null {
  switch (recurrence) {
    case "daily":
      return addDaysUtc(anchor, 1);
    case "weekly":
      return addDaysUtc(anchor, 7);
    case "biweekly":
      return addDaysUtc(anchor, 14);
    case "monthly":
      return addMonthsKeepDayUtc(anchor, 1);
    case "quarterly":
      return addMonthsKeepDayUtc(anchor, 3);
    case "semiannual":
      return addMonthsKeepDayUtc(anchor, 6);
    case "annual":
      return addMonthsKeepDayUtc(anchor, 12);
    default:
      return null; // "none" não deve chegar aqui
  }
}

export async function createNextRecurringTaskFromCompleted(args: {
  completedTaskId: string;
}) {
  const t = await prisma.task.findUnique({
    where: { id: args.completedTaskId },
    select: {
      id: true,
      title: true,
      description: true,
      delegation: true,
      responsible: true,
      term: true,
      deadlineTime: true,
      recurrence: true,
      recurrenceAnchor: true,
      urgency: true,
      projectId: true,
      carbonCopies: { select: { slackUserId: true } },
      status: true,
    },
  });

  if (!t) return null;
  if (t.status !== "done") return null;
  if (!t.recurrence || t.recurrence === "none") return null;

  // ✅ regra 2: base é a data original (anchor); se não existir, cai no term
  const base = t.recurrenceAnchor ?? t.term;
  if (!base) return null;

  const nextAnchor = computeNextAnchor(base, t.recurrence);
  if (!nextAnchor) return null;

  const ccUnique = Array.from(new Set(t.carbonCopies.map((c) => c.slackUserId))).filter(Boolean);

  const created = await prisma.$transaction(async (tx) => {
    const next = await tx.task.create({
      data: {
        title: t.title,
        description: t.description ?? null,
        delegation: t.delegation,
        responsible: t.responsible,
        term: nextAnchor,
        deadlineTime: t.deadlineTime ?? null,
        recurrence: t.recurrence,
        recurrenceAnchor: nextAnchor,
        urgency: t.urgency,
        status: "pending",
        projectId: t.projectId ?? null,

        ...(ccUnique.length
          ? {
              carbonCopies: {
                createMany: {
                  data: ccUnique.map((slackUserId) => ({ slackUserId })),
                  skipDuplicates: true,
                },
              },
            }
          : {}),
      },
      select: { id: true, term: true },
    });

    return next;
  });

  return created;
}
