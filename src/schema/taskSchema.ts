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

/**
 * term pode chegar como:
 * - Date (quando você já cria com new Date(`${iso}T03:00:00Z`))
 * - string "YYYY-MM-DD"
 * - string ISO "YYYY-MM-DDTHH:mm:ss.sssZ"
 * - null/undefined
 *
 * Saída: Date | null | undefined (depois do transform no schema, vira Date | null)
 */
const termSchema = z.preprocess((v) => {
  if (v === null || v === undefined) return null;

  // já é Date
  if (v instanceof Date) return v;

  // string
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;

    // YYYY-MM-DD => converte para 00:00 SP
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return toSaoPauloMidnightDate(s);
    }

    // ISO datetime
    const d = new Date(s);
    if (isValidDate(d)) return d;

    return null;
  }

  // qualquer outra coisa -> null
  return null;
}, z.date().nullable());

/**
 * deadlineTime:
 * - "HH:MM"
 * - "" (vira null)
 * - null/undefined
 */
const deadlineTimeSchema = z.preprocess((v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  return null;
}, z.string().regex(/^\d{2}:\d{2}$/).nullable().optional());

/**
 * Normaliza recurrence:
 * - "none" => null
 * - undefined => undefined (mas no transform final, colocamos null pra padronizar)
 */
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

    // term pode ser Date ou string; sai Date|null
    term: termSchema.optional(),

    deadlineTime: deadlineTimeSchema,

    // "none" será tratado no transform final
    recurrence: recurrenceSchema,

    projectId: z.string().uuid().nullable().optional(),

    dependsOnId: z.string().uuid().nullable().optional(),

    urgency: urgencySchema,

    carbonCopies: z.array(slackUserIdSchema).optional().default([]),
  })
  .transform((data) => {
    // term: garante Date|null
    const term = data.term ?? null;

    // recurrence: padroniza para null quando não tiver
    // e também troca "none" -> null
    const recurrenceRaw = data.recurrence ?? null;
    const recurrence = recurrenceRaw === "none" ? null : recurrenceRaw;

    // deadlineTime: se vier undefined, vira null (padroniza)
    const deadlineTime = data.deadlineTime ?? null;

    // carbonCopies: remove duplicados / vazios
    const carbonCopies = Array.from(new Set((data.carbonCopies ?? []).filter(Boolean)));

    return {
      ...data,
      term,
      recurrence,
      deadlineTime,
      carbonCopies,
    };
  });

/**
 * Tipo do INPUT (antes do transform)
 * Útil se você recebe "term" como string/Date.
 */
export type CreateTaskInput = z.input<typeof createTaskSchema>;

/**
 * Tipo do OUTPUT (depois do transform)
 * Esse é o tipo que você deve passar pro createTaskService/Prisma.
 */
export type CreateTaskParsed = z.output<typeof createTaskSchema>;

/**
 * Helper opcional (pra usar nos handlers)
 */
export function parseCreateTask(payload: unknown): CreateTaskParsed {
  return createTaskSchema.parse(payload);
}
