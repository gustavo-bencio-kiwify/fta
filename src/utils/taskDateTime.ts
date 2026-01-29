// src/utils/taskDateTime.ts
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * term: Date (do banco) representando o dia
 * deadlineTime: "HH:MM" (opcional)
 * Retorna janelas locais (SP) para Calendar API.
 */
export function buildOneHourWindow(term: Date, deadlineTime?: string | null) {
  const isoDate = term.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = deadlineTime && /^\d{2}:\d{2}$/.test(deadlineTime) ? deadlineTime : "10:00";

  const startLocal = `${isoDate}T${time}:00`; // YYYY-MM-DDTHH:MM:SS

  // soma +1h (SP offset -03:00, sem DST atualmente)
  const start = new Date(`${startLocal}-03:00`);
  start.setHours(start.getHours() + 1);

  const endLocal = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}T${pad2(
    start.getHours()
  )}:${pad2(start.getMinutes())}:00`;

  return { startLocalDateTime: startLocal, endLocalDateTime: endLocal };
}
