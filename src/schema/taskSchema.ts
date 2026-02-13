// src/schema/taskSchema.ts
import { z } from "zod";

// Slack IDs: Uxxxxxxxx, Wxxxxxxxx etc.
const slackUserIdSchema = z.string().regex(/^[UW][A-Z0-9]{8,}$/);

// Enums
export const urgencySchema = z.enum(["light", "asap", "turbo"]);

export const recurrenceValueSchema = z.enum([
  "none",
  "daily",
  "weekly",
  "biweekly",
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
]);

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// 00:00 São Paulo (UTC-3) => 03:00:00Z
function toSaoPauloMidnightDate(dateIso: string) {
  return new Date(`${dateIso}T03:00:00.000Z`);
}

function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

const termSchema = z.preprocess((v) => {
  if (v === null || v === undefined) return null;

  if (v instanceof Date) return v;

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return toSaoPauloMidnightDate(s);
    }

    const d = new Date(s);
    if (isValidDate(d)) return d;

    return null;
  }

  return null;
}, z.date().nullable());

const deadlineTimeSchema = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}, z.string().regex(/^\d{2}:\d{2}$/).nullable().optional());

const recurrenceSchema = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    return s;
  }
  return v;
}, recurrenceValueSchema.nullable().optional());

export const createTaskSchema = z
  .object({
    title: z.string().min(1).transform((s) => s.trim()),
    description: z
      .string()
      .optional()
      .transform((s) => (s?.trim() ? s.trim() : undefined)),

    delegation: slackUserIdSchema,
    responsible: slackUserIdSchema,

    term: termSchema.optional(),
    deadlineTime: deadlineTimeSchema,

    recurrence: recurrenceSchema,

    projectId: z.string().uuid().nullable().optional(),
    dependsOnId: z.string().uuid().nullable().optional(),

    urgency: urgencySchema,

    carbonCopies: z.array(slackUserIdSchema).optional().default([]),

    // ✅ NOVO
    calendarPrivate: z.boolean().optional().default(false),
  })
  .transform((data) => {
    const term = data.term ?? null;

    const recurrenceRaw = data.recurrence ?? null;
    const recurrence = recurrenceRaw === "none" ? null : recurrenceRaw;

    const deadlineTime = data.deadlineTime ?? null;

    const carbonCopies = Array.from(new Set((data.carbonCopies ?? []).filter(Boolean)));

    return {
      ...data,
      term,
      recurrence,
      deadlineTime,
      carbonCopies,
    };
  });

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type CreateTaskParsed = z.output<typeof createTaskSchema>;

export function parseCreateTask(payload: unknown): CreateTaskParsed {
  return createTaskSchema.parse(payload);
}
