// src/routes/admin.ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import formbody from "@fastify/formbody";
import { prisma } from "../lib/prisma";
import {
  clearAdminCookie,
  getAdminUser,
  requireAdmin,
  setAdminCookie,
  signAdminSession,
} from "../admin/auth";
import { escHtml, fmtDate, fmtDateTime, layout } from "../admin/html";
import { verifyPassword } from "../admin/password";

import type {
  Recurrence,
  TaskStatus,
  Urgency,
  ProjectStatus,
} from "../generated/prisma/enums";

import {
  syncCalendarEventForTask,
  deleteCalendarEventForTask,
} from "../services/googleCalendar";

import { resolveManySlackNames } from "../services/slackUserLookup";

function pickString(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  return s;
}

function pickBool(v: unknown) {
  return v === true || v === "on" || v === "true" || v === "1";
}

// YYYY-MM-DD -> salva como 00:00 SP (== 03:00Z)
function dateIsoToSpMidnightUtc(dateIso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const d = new Date(`${dateIso}T03:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeRecurrence(r: unknown): Recurrence | null {
  if (r === null || r === undefined) return null;
  const v = pickString(r);
  if (!v || v === "none") return null;
  const allowed = new Set([
    "daily",
    "weekly",
    "biweekly",
    "monthly",
    "quarterly",
    "semiannual",
    "annual",
  ]);
  return allowed.has(v) ? (v as Recurrence) : null;
}

function normalizeUrgency(u: unknown): Urgency {
  const v = pickString(u) as Urgency;
  if (v === "light" || v === "asap" || v === "turbo") return v;
  return "light";
}

function normalizeTaskStatus(s: unknown): TaskStatus {
  const v = pickString(s) as TaskStatus;
  if (v === "pending" || v === "blocked" || v === "done" || v === "overdue")
    return v;
  return "pending";
}

function normalizeProjectStatus(s: unknown): ProjectStatus {
  const v = pickString(s) as ProjectStatus;
  if (v === "active" || v === "concluded") return v;
  return "active";
}

function redirectWithFlash(
  reply: FastifyReply,
  to: string,
  flash?: { kind: "ok" | "err"; message: string }
) {
  if (!flash) return reply.redirect(to);
  const u = new URL(`http://local${to}`);
  u.searchParams.set("f", flash.kind);
  u.searchParams.set("m", flash.message);
  return reply.redirect(u.pathname + u.search);
}

function readFlash(request: FastifyRequest) {
  const { f, m } = request.query as any;
  if (!f || !m) return null;
  if (f !== "ok" && f !== "err") return null;
  return { kind: f as "ok" | "err", message: String(m) };
}

type KnownSlackUsers = {
  ids: string[];
  nameById: Record<string, string>;
  datalistHtml: string; // <datalist ...>...</datalist>
};

// ✅ Lista "conhecida" de usuários (pra autocomplete por nome no admin)
// - pega IDs de tasks recentes, members de projetos e CCs
async function getKnownSlackUsers(): Promise<KnownSlackUsers> {
  const [recentTasks, projectMembers, carbonCopies] = await Promise.all([
    prisma.task.findMany({
      select: { delegation: true, responsible: true },
      orderBy: { updatedAt: "desc" },
      take: 400,
    }),
    prisma.projectMember.findMany({
      select: { slackUserId: true },
      orderBy: { createdAt: "desc" },
      take: 800,
    }),
    prisma.taskCarbonCopy.findMany({
      select: { slackUserId: true },
      orderBy: { createdAt: "desc" },
      take: 800,
    }),
  ]);

  const ids = Array.from(
    new Set(
      [
        ...recentTasks.flatMap((t) => [t.delegation, t.responsible]),
        ...projectMembers.map((m) => m.slackUserId),
        ...carbonCopies.map((c) => c.slackUserId),
      ]
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
    )
  );

  const nameById = await resolveManySlackNames(ids);

  // datalist (autocomplete): value = ID, texto = Nome (ID)
  const options = ids
    .map((id) => {
      const name = nameById[id] ?? id;
      return `<option value="${escHtml(id)}">${escHtml(name)} (${escHtml(
        id
      )})</option>`;
    })
    .join("");

  const datalistHtml = `<datalist id="slackUsers">${options}</datalist>`;

  return { ids, nameById, datalistHtml };
}

export async function adminRoutes(app: FastifyInstance) {
  app.register(formbody);

  app.get("/admin", async (_req, reply) => reply.redirect("/admin/tasks"));

  app.get("/admin/login", async (request, reply) => {
    const flash = readFlash(request);
    const next = pickString((request.query as any)?.next) || "/admin/tasks";
    const body = `
      <div class="card" style="max-width:520px; margin:40px auto 0;">
        <h1>FTA Admin</h1>
        <p class="muted">Login de administrador</p>
        <form method="post" action="/admin/login">
          <input type="hidden" name="next" value="${escHtml(next)}" />
          <div style="margin-top:14px;">
            <label>Usuário</label>
            <input name="username" autocomplete="username" />
          </div>
          <div style="margin-top:12px;">
            <label>Senha</label>
            <input name="password" type="password" autocomplete="current-password" />
          </div>
          <div class="actions">
            <button type="submit">Entrar</button>
          </div>
          <p class="small" style="margin-top:14px;">
            Credenciais do admin ficam no banco (tabela <span class="mono">admin-users</span>).
            Sessão usa cookie assinado via <span class="mono">ADMIN_SESSION_SECRET</span>.
          </p>
        </form>
      </div>
    `;
    reply
      .type("text/html")
      .send(layout({ title: "FTA Admin - Login", user: null, flash, body }));
  });

  app.post("/admin/login", async (request, reply) => {
    const body = request.body as any;
    const username = pickString(body?.username);
    const password = pickString(body?.password);
    const next = pickString(body?.next) || "/admin/tasks";

    const admin = await prisma.adminUser.findUnique({
      where: { username },
      select: { id: true, username: true, passwordHash: true, isActive: true },
    });

    const ok = !!admin && admin.isActive && verifyPassword(password, admin.passwordHash);
    if (!ok) {
      return redirectWithFlash(reply, `/admin/login?next=${encodeURIComponent(next)}`, {
        kind: "err",
        message: "Usuário ou senha inválidos",
      });
    }

    prisma.adminUser
      .update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } })
      .catch(() => void 0);

    const token = signAdminSession({ username });
    setAdminCookie(reply, token);
    return redirectWithFlash(reply, next, { kind: "ok", message: "Login OK" });
  });

  app.post("/admin/logout", async (_request, reply) => {
    clearAdminCookie(reply);
    return reply.redirect("/admin/login");
  });

  // ✅ Tudo abaixo exige login
  app.register(async (protectedApp) => {
    protectedApp.addHook("preHandler", requireAdmin);

    // TASKS (LISTA)
    protectedApp.get("/admin/tasks", async (request, reply) => {
      const flash = readFlash(request);
      const user = getAdminUser(request);
      const q = pickString((request.query as any)?.q);
      const status = pickString((request.query as any)?.status);
      const projectId = pickString((request.query as any)?.projectId);
      const page = Math.max(1, Number((request.query as any)?.page ?? 1));
      const pageSize = 25;

      const where: any = {};
      if (q) where.title = { contains: q, mode: "insensitive" };
      if (status && status !== "all") where.status = status;
      if (projectId && projectId !== "all") where.projectId = projectId;

      const [projects, total, tasks] = await Promise.all([
        prisma.project.findMany({
          select: { id: true, name: true },
          orderBy: { createdAt: "desc" },
        }),
        prisma.task.count({ where }),
        prisma.task.findMany({
          where,
          include: { project: { select: { id: true, name: true } } },
          orderBy: { updatedAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      // ✅ Resolve nomes apenas dos IDs da página (leve)
      const idsToResolve = tasks
        .flatMap((t) => [t.responsible, t.delegation])
        .filter(Boolean);
      const nameById = await resolveManySlackNames(idsToResolve);

      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const prev = page > 1 ? page - 1 : null;
      const next = page < totalPages ? page + 1 : null;

      const rows = tasks
        .map((t) => {
          const termIso = t.term ? fmtDate(t.term) : "";
          const proj = t.project?.name ?? "";

          const respName = nameById[t.responsible] ?? t.responsible;

          return `
            <tr>
              <td><a href="/admin/tasks/${escHtml(t.id)}" class="mono">${escHtml(
            t.id.slice(0, 8)
          )}</a></td>
              <td>${escHtml(t.title)}</td>
              <td><span class="pill">${escHtml(t.status)}</span></td>
              <td>${escHtml(termIso)}</td>
              <td>${escHtml(t.deadlineTime ?? "")}</td>
              <td><span class="pill">${escHtml(t.urgency)}</span></td>
              <td>${escHtml(proj)}</td>
              <td>
                <div>${escHtml(respName)}</div>
                <div class="small mono">${escHtml(t.responsible)}</div>
              </td>
              <td>${escHtml(fmtDateTime(t.updatedAt))}</td>
            </tr>
          `;
        })
        .join("");

      const projectOptions = [
        `<option value="all" ${
          projectId === "all" || !projectId ? "selected" : ""
        }>Todos</option>`,
        ...projects.map(
          (p) =>
            `<option value="${escHtml(p.id)}" ${
              p.id === projectId ? "selected" : ""
            }>${escHtml(p.name)}</option>`
        ),
      ].join("");

      const statusOptions = ["all", "pending", "blocked", "overdue", "done"]
        .map(
          (s) =>
            `<option value="${s}" ${
              s === (status || "all") ? "selected" : ""
            }>${s}</option>`
        )
        .join("");

      const pager = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-top:12px;">
          <div class="small">${total} tasks • página ${page} / ${totalPages}</div>
          <div style="display:flex; gap:10px;">
            ${
              prev
                ? `<a class="pill" href="/admin/tasks?${new URLSearchParams({
                    q,
                    status: status || "all",
                    projectId: projectId || "all",
                    page: String(prev),
                  }).toString()}">← Anterior</a>`
                : ""
            }
            ${
              next
                ? `<a class="pill" href="/admin/tasks?${new URLSearchParams({
                    q,
                    status: status || "all",
                    projectId: projectId || "all",
                    page: String(next),
                  }).toString()}">Próxima →</a>`
                : ""
            }
          </div>
        </div>
      `;

      const body = `
        <div class="topbar">
          <h1>Tasks</h1>
          <div class="actions">
            <a href="/admin/tasks/new"><button type="button">+ Nova task</button></a>
          </div>
        </div>

        <div class="card" style="margin-top:12px;">
          <form method="get" action="/admin/tasks" class="filters">
            <div>
              <label>Busca (título)</label>
              <input name="q" value="${escHtml(q)}" placeholder="ex: reunião" />
            </div>
            <div>
              <label>Status</label>
              <select name="status">${statusOptions}</select>
            </div>
            <div>
              <label>Projeto</label>
              <select name="projectId">${projectOptions}</select>
            </div>
            <div>
              <button type="submit">Filtrar</button>
            </div>
          </form>
        </div>

        <div class="card" style="margin-top:12px; overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Título</th>
                <th>Status</th>
                <th>Term</th>
                <th>Hora</th>
                <th>Urgência</th>
                <th>Projeto</th>
                <th>Resp</th>
                <th>Atualizado</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="9" class="muted">Nenhuma task encontrada.</td></tr>`}</tbody>
          </table>
        </div>

        ${pager}
      `;

      reply
        .type("text/html")
        .send(layout({ title: "FTA Admin - Tasks", user, flash, body }));
    });

    // TASKS (NEW)
    protectedApp.get("/admin/tasks/new", async (request, reply) => {
      const flash = readFlash(request);
      const user = getAdminUser(request);

      const [projects, known] = await Promise.all([
        prisma.project.findMany({
          select: { id: true, name: true },
          orderBy: { createdAt: "desc" },
        }),
        getKnownSlackUsers(),
      ]);

      const projectOptions = [
        `<option value="">(sem projeto)</option>`,
        ...projects.map(
          (p) => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`
        ),
      ].join("");

      const body = `
        <h1>Nova task</h1>
        <div class="card">
          ${known.datalistHtml}
          <form method="post" action="/admin/tasks/new">
            <div class="row">
              <div>
                <label>Título *</label>
                <input name="title" required />
              </div>
              <div>
                <label>Status</label>
                <select name="status">
                  <option value="pending" selected>pending</option>
                  <option value="blocked">blocked</option>
                  <option value="overdue">overdue</option>
                  <option value="done">done</option>
                </select>
              </div>
            </div>

            <div style="margin-top:12px;">
              <label>Descrição</label>
              <textarea name="description"></textarea>
            </div>

            <div class="row" style="margin-top:12px;">
              <div>
                <label>Delegador (digite nome ou cole ID) *</label>
                <input name="delegation" list="slackUsers" placeholder="Nome… ou U123…" required />
              </div>
              <div>
                <label>Responsável (digite nome ou cole ID) *</label>
                <input name="responsible" list="slackUsers" placeholder="Nome… ou U123…" required />
              </div>
            </div>

            <div class="row" style="margin-top:12px;">
              <div>
                <label>Prazo (term)</label>
                <input name="termIso" type="date" />
              </div>
              <div>
                <label>Hora (deadlineTime)</label>
                <input name="deadlineTime" placeholder="HH:MM" />
              </div>
            </div>

            <div class="row" style="margin-top:12px;">
              <div>
                <label>Urgência</label>
                <select name="urgency">
                  <option value="light" selected>light</option>
                  <option value="asap">asap</option>
                  <option value="turbo">turbo</option>
                </select>
              </div>
              <div>
                <label>Recorrência</label>
                <select name="recurrence">
                  <option value="" selected>(sem recorrência)</option>
                  <option value="daily">daily</option>
                  <option value="weekly">weekly</option>
                  <option value="biweekly">biweekly</option>
                  <option value="monthly">monthly</option>
                  <option value="quarterly">quarterly</option>
                  <option value="semiannual">semiannual</option>
                  <option value="annual">annual</option>
                </select>
              </div>
            </div>

            <div class="row" style="margin-top:12px;">
              <div>
                <label>Projeto</label>
                <select name="projectId">${projectOptions}</select>
              </div>
              <div>
                <label>DependsOnId</label>
                <input name="dependsOnId" placeholder="uuid" />
              </div>
            </div>

            <div style="margin-top:12px;">
              <label>CCs (IDs separados por vírgula, pode usar autocomplete e depois separar)</label>
              <input name="ccs" list="slackUsers" placeholder="U123,U456" />
              <div class="small">No admin, CC cria TaskCarbonCopy com email null.</div>
            </div>

            <div style="margin-top:12px;">
              <label><input type="checkbox" name="calendarPrivate" /> Calendar privado</label>
            </div>

            <div class="actions">
              <button type="submit">Criar</button>
              <a href="/admin/tasks"><button type="button" class="link">Cancelar</button></a>
            </div>
          </form>
        </div>
      `;

      reply
        .type("text/html")
        .send(layout({ title: "FTA Admin - Nova task", user, flash, body }));
    });

    protectedApp.post("/admin/tasks/new", async (request, reply) => {
      const body = request.body as any;
      const title = pickString(body?.title);
      const description = pickString(body?.description) || null;
      const delegation = pickString(body?.delegation);
      const responsible = pickString(body?.responsible);
      const termIso = pickString(body?.termIso);
      const deadlineTime = pickString(body?.deadlineTime) || null;
      const urgency = normalizeUrgency(body?.urgency);
      const status = normalizeTaskStatus(body?.status);
      const recurrence = normalizeRecurrence(body?.recurrence);
      const projectId = pickString(body?.projectId) || null;
      const dependsOnId = pickString(body?.dependsOnId) || null;
      const calendarPrivate = pickBool(body?.calendarPrivate);

      const ccRaw = pickString(body?.ccs);
      const ccs = Array.from(
        new Set(
          ccRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        )
      );

      if (!title || !delegation || !responsible) {
        return redirectWithFlash(reply, "/admin/tasks/new", {
          kind: "err",
          message: "Campos obrigatórios: título, delegador e responsável.",
        });
      }

      const term = termIso ? dateIsoToSpMidnightUtc(termIso) : null;

      const task = await prisma.task.create({
        data: {
          title,
          description,
          delegation,
          responsible,
          term,
          deadlineTime,
          urgency,
          status,
          recurrence,
          recurrenceAnchor: recurrence ? term : null,
          projectId,
          dependsOnId,
          calendarPrivate,
          ...(ccs.length
            ? {
                carbonCopies: {
                  createMany: {
                    data: ccs.map((slackUserId) => ({
                      slackUserId,
                      email: null,
                    })),
                    skipDuplicates: true,
                  },
                },
              }
            : {}),
        },
      });

      if (term) {
        void syncCalendarEventForTask(task.id).catch((e) => {
          console.error("[admin] calendar sync failed (create)", task.id, e);
        });
      }

      return redirectWithFlash(reply, `/admin/tasks/${task.id}`, {
        kind: "ok",
        message: "Task criada",
      });
    });

    // TASKS (EDIT)
    protectedApp.get("/admin/tasks/:id", async (request, reply) => {
      const flash = readFlash(request);
      const user = getAdminUser(request);
      const id = pickString((request.params as any)?.id);

      const [task, projects, known] = await Promise.all([
        prisma.task.findUnique({
          where: { id },
          include: {
            project: { select: { id: true, name: true } },
            carbonCopies: { select: { id: true, slackUserId: true, email: true } },
          },
        }),
        prisma.project.findMany({
          select: { id: true, name: true },
          orderBy: { createdAt: "desc" },
        }),
        getKnownSlackUsers(),
      ]);

      if (!task) {
        const body = `<div class="card"><h1>Task não encontrada</h1><p class="muted">${escHtml(
          id
        )}</p></div>`;
        return reply
          .type("text/html")
          .send(layout({ title: "FTA Admin - Task", user, flash, body }));
      }

      const projectOptions = [
        `<option value="">(sem projeto)</option>`,
        ...projects.map(
          (p) =>
            `<option value="${escHtml(p.id)}" ${
              p.id === task.projectId ? "selected" : ""
            }>${escHtml(p.name)}</option>`
        ),
      ].join("");

      const recurrenceValue = task.recurrence ?? "";

      const ccList = (task.carbonCopies ?? [])
        .map(
          (c) =>
            `<span class="pill mono">${escHtml(c.slackUserId)}</span>`
        )
        .join(" ");

      const respName = known.nameById[task.responsible] ?? task.responsible;
      const delName = known.nameById[task.delegation] ?? task.delegation;

      const body = `
        <div class="topbar">
          <div>
            <h1>Editar task</h1>
            <div class="small mono">${escHtml(task.id)}</div>
            <div class="small">Delegador: <b>${escHtml(delName)}</b> • Responsável: <b>${escHtml(respName)}</b></div>
          </div>
          <div class="actions">
            <a href="/admin/tasks"><button type="button" class="link">← Voltar</button></a>
          </div>
        </div>

        <div class="card" style="margin-top:12px;">
          ${known.datalistHtml}
          <form method="post" action="/admin/tasks/${escHtml(task.id)}/save">
            <div class="row">
              <div>
                <label>Título *</label>
                <input name="title" required value="${escHtml(task.title)}" />
              </div>
              <div>
                <label>Status</label>
                <select name="status">
                  ${["pending", "blocked", "overdue", "done"]
                    .map(
                      (s) =>
                        `<option value="${s}" ${
                          s === task.status ? "selected" : ""
                        }>${s}</option>`
                    )
                    .join("")}
                </select>
              </div>
            </div>

            <div style="margin-top:12px;">
              <label>Descrição</label>
              <textarea name="description">${escHtml(
                task.description ?? ""
              )}</textarea>
            </div>

            <div class="row" style="margin-top:12px;">
              <div>
                <label>Delegador (digite nome ou cole ID) *</label>
                <input name="delegation" list="slackUsers" required value="${escHtml(
                  task.delegation
                )}" />
              </div>
              <div>
                <label>Responsável (digite nome ou cole ID) *</label>
                <input name="responsible" list="slackUsers" required value="${escHtml(
                  task.responsible
                )}" />
              </div>
            </div>

            <div class="row" style="margin-top:12px;">
              <div>
                <label>Prazo (term)</label>
                <input name="termIso" type="date" value="${escHtml(
                  task.term ? fmtDate(task.term) : ""
                )}" />
              </div>
              <div>
                <label>Hora (deadlineTime)</label>
                <input name="deadlineTime" value="${escHtml(
                  task.deadlineTime ?? ""
                )}" placeholder="HH:MM" />
              </div>
            </div>

            <div class="row" style="margin-top:12px;">
              <div>
                <label>Urgência</label>
                <select name="urgency">
                  ${["light", "asap", "turbo"]
                    .map(
                      (u) =>
                        `<option value="${u}" ${
                          u === task.urgency ? "selected" : ""
                        }>${u}</option>`
                    )
                    .join("")}
                </select>
              </div>
              <div>
                <label>Recorrência</label>
                <select name="recurrence">
                  <option value="" ${
                    !recurrenceValue ? "selected" : ""
                  }>(sem recorrência)</option>
                  ${[
                    "daily",
                    "weekly",
                    "biweekly",
                    "monthly",
                    "quarterly",
                    "semiannual",
                    "annual",
                  ]
                    .map(
                      (r) =>
                        `<option value="${r}" ${
                          r === recurrenceValue ? "selected" : ""
                        }>${r}</option>`
                    )
                    .join("")}
                </select>
                <div class="small">Pra cancelar recorrência: selecione “(sem recorrência)”.</div>
              </div>
            </div>

            <div class="row" style="margin-top:12px;">
              <div>
                <label>Projeto</label>
                <select name="projectId">${projectOptions}</select>
              </div>
              <div>
                <label>DependsOnId</label>
                <input name="dependsOnId" value="${escHtml(
                  task.dependsOnId ?? ""
                )}" />
              </div>
            </div>

            <div style="margin-top:12px;">
              <label><input type="checkbox" name="calendarPrivate" ${
                task.calendarPrivate ? "checked" : ""
              } /> Calendar privado</label>
              <div class="small">Se houver term, ao salvar tentamos sincronizar o Google Calendar (se configurado).</div>
            </div>

            <div class="actions">
              <button type="submit">Salvar</button>
              <button type="submit" name="action" value="sync_calendar" class="link">Sync Calendar</button>
              <button type="submit" name="action" value="delete_calendar" class="link danger">Apagar evento</button>
              <button type="submit" name="action" value="delete_task" class="danger">Deletar task</button>
            </div>
          </form>
        </div>

        <h2>Carbon Copies</h2>
        <div class="card">
          <div>${ccList || `<span class="muted">Sem CCs.</span>`}</div>
          <form method="post" action="/admin/tasks/${escHtml(
            task.id
          )}/cc" style="margin-top:12px;">
            ${known.datalistHtml}
            <div class="row">
              <div>
                <label>Adicionar CC (digite nome ou cole ID)</label>
                <input name="slackUserId" list="slackUsers" placeholder="Nome… ou U123..." />
              </div>
              <div>
                <label>Remover CC (digite nome ou cole ID)</label>
                <input name="removeSlackUserId" list="slackUsers" placeholder="Nome… ou U123..." />
              </div>
            </div>
            <div class="actions">
              <button type="submit">Aplicar</button>
            </div>
          </form>
        </div>
      `;

      reply
        .type("text/html")
        .send(layout({ title: "FTA Admin - Editar task", user, flash, body }));
    });

    protectedApp.post("/admin/tasks/:id/save", async (request, reply) => {
      const id = pickString((request.params as any)?.id);
      const body = request.body as any;
      const action = pickString(body?.action);

      if (action === "delete_task") {
        await prisma.task.delete({ where: { id } }).catch(() => null);
        return redirectWithFlash(reply, "/admin/tasks", {
          kind: "ok",
          message: "Task deletada",
        });
      }

      if (action === "delete_calendar") {
        await deleteCalendarEventForTask(id).catch((e) => {
          console.error("[admin] delete calendar failed", id, e);
        });
        return redirectWithFlash(reply, `/admin/tasks/${id}`, {
          kind: "ok",
          message: "Evento removido (se existia)",
        });
      }

      const title = pickString(body?.title);
      const description = pickString(body?.description) || null;
      const delegation = pickString(body?.delegation);
      const responsible = pickString(body?.responsible);
      const termIso = pickString(body?.termIso);
      const deadlineTime = pickString(body?.deadlineTime) || null;
      const urgency = normalizeUrgency(body?.urgency);
      const status = normalizeTaskStatus(body?.status);
      const recurrence = normalizeRecurrence(body?.recurrence);
      const projectId = pickString(body?.projectId) || null;
      const dependsOnId = pickString(body?.dependsOnId) || null;
      const calendarPrivate = pickBool(body?.calendarPrivate);

      if (!title || !delegation || !responsible) {
        return redirectWithFlash(reply, `/admin/tasks/${id}`, {
          kind: "err",
          message: "Campos obrigatórios: título, delegador e responsável.",
        });
      }

      const term = termIso ? dateIsoToSpMidnightUtc(termIso) : null;

      await prisma.task.update({
        where: { id },
        data: {
          title,
          description,
          delegation,
          responsible,
          term,
          deadlineTime,
          urgency,
          status,
          recurrence,
          recurrenceAnchor: recurrence ? term : null,
          projectId,
          dependsOnId,
          calendarPrivate,
        },
      });

      if (action === "sync_calendar" || term) {
        await syncCalendarEventForTask(id).catch((e) => {
          console.error("[admin] calendar sync failed", id, e);
        });
      }

      return redirectWithFlash(reply, `/admin/tasks/${id}`, {
        kind: "ok",
        message: "Salvo",
      });
    });

    protectedApp.post("/admin/tasks/:id/cc", async (request, reply) => {
      const id = pickString((request.params as any)?.id);
      const body = request.body as any;
      const add = pickString(body?.slackUserId);
      const remove = pickString(body?.removeSlackUserId);

      if (remove) {
        await prisma.taskCarbonCopy.deleteMany({
          where: { taskId: id, slackUserId: remove },
        });
      }
      if (add) {
        await prisma.taskCarbonCopy
          .create({ data: { taskId: id, slackUserId: add, email: null } })
          .catch(() => null);
      }
      return redirectWithFlash(reply, `/admin/tasks/${id}`, {
        kind: "ok",
        message: "CCs atualizados",
      });
    });

    // PROJECTS (LISTA)
    protectedApp.get("/admin/projects", async (request, reply) => {
      const flash = readFlash(request);
      const user = getAdminUser(request);

      const projects = await prisma.project.findMany({
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { tasks: true, members: true } } },
      });

      const rows = projects
        .map((p) => {
          return `
            <tr>
              <td><a href="/admin/projects/${escHtml(p.id)}" class="mono">${escHtml(
            p.id.slice(0, 8)
          )}</a></td>
              <td>${escHtml(p.name)}</td>
              <td><span class="pill">${escHtml(p.status)}</span></td>
              <td>${escHtml(p._count.tasks)}</td>
              <td>${escHtml(p._count.members)}</td>
              <td>${escHtml(fmtDateTime(p.createdAt))}</td>
            </tr>
          `;
        })
        .join("");

      const body = `
        <div class="topbar">
          <h1>Projects</h1>
          <div class="actions">
            <a href="/admin/projects/new"><button type="button">+ Novo projeto</button></a>
          </div>
        </div>

        <div class="card" style="margin-top:12px; overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Nome</th>
                <th>Status</th>
                <th>#Tasks</th>
                <th>#Members</th>
                <th>Criado</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="6" class="muted">Nenhum projeto.</td></tr>`}</tbody>
          </table>
        </div>
      `;

      reply
        .type("text/html")
        .send(layout({ title: "FTA Admin - Projects", user, flash, body }));
    });

    // PROJECTS (NEW)
    protectedApp.get("/admin/projects/new", async (request, reply) => {
      const flash = readFlash(request);
      const user = getAdminUser(request);

      const body = `
        <h1>Novo projeto</h1>
        <div class="card">
          <form method="post" action="/admin/projects/new">
            <div class="row">
              <div>
                <label>Nome *</label>
                <input name="name" required />
              </div>
              <div>
                <label>Status</label>
                <select name="status">
                  <option value="active" selected>active</option>
                  <option value="concluded">concluded</option>
                </select>
              </div>
            </div>
            <div style="margin-top:12px;">
              <label>Descrição</label>
              <textarea name="description"></textarea>
            </div>
            <div class="row" style="margin-top:12px;">
              <div>
                <label>End date</label>
                <input type="date" name="endDateIso" />
              </div>
              <div>
                <label>Criado por (Slack ID)</label>
                <input name="createdBySlackId" placeholder="U123..." />
              </div>
            </div>
            <div class="actions">
              <button type="submit">Criar</button>
              <a href="/admin/projects"><button type="button" class="link">Cancelar</button></a>
            </div>
          </form>
        </div>
      `;

      reply
        .type("text/html")
        .send(layout({ title: "FTA Admin - Novo projeto", user, flash, body }));
    });

    protectedApp.post("/admin/projects/new", async (request, reply) => {
      const body = request.body as any;
      const name = pickString(body?.name);
      const description = pickString(body?.description) || null;
      const status = normalizeProjectStatus(body?.status);
      const endDateIso = pickString(body?.endDateIso);
      const createdBySlackId = pickString(body?.createdBySlackId) || null;
      const endDate = endDateIso ? dateIsoToSpMidnightUtc(endDateIso) : null;

      if (!name) {
        return redirectWithFlash(reply, "/admin/projects/new", {
          kind: "err",
          message: "Nome é obrigatório",
        });
      }

      const project = await prisma.project.create({
        data: {
          name,
          description,
          status,
          endDate,
          createdBySlackId,
        },
      });

      return redirectWithFlash(reply, `/admin/projects/${project.id}`, {
        kind: "ok",
        message: "Projeto criado",
      });
    });

    // PROJECTS (EDIT)
    protectedApp.get("/admin/projects/:id", async (request, reply) => {
      const flash = readFlash(request);
      const user = getAdminUser(request);
      const id = pickString((request.params as any)?.id);

      const project = await prisma.project.findUnique({
        where: { id },
        include: {
          members: { orderBy: { createdAt: "desc" } },
          _count: { select: { tasks: true, members: true } },
        },
      });

      if (!project) {
        const body = `<div class="card"><h1>Projeto não encontrado</h1><p class="muted">${escHtml(
          id
        )}</p></div>`;
        return reply
          .type("text/html")
          .send(layout({ title: "FTA Admin - Project", user, flash, body }));
      }

      // ✅ nomes dos membros
      const memberIds = project.members.map((m) => m.slackUserId);
      const memberNames = await resolveManySlackNames(memberIds);

      const membersRows = project.members
        .map((m) => {
          const nm = memberNames[m.slackUserId] ?? m.slackUserId;
          return `<tr>
            <td>
              <div>${escHtml(nm)}</div>
              <div class="small mono">${escHtml(m.slackUserId)}</div>
            </td>
            <td>${escHtml(m.email ?? "")}</td>
            <td>${escHtml(fmtDateTime(m.createdAt))}</td>
          </tr>`;
        })
        .join("");

      const body = `
        <div class="topbar">
          <div>
            <h1>Editar projeto</h1>
            <div class="small mono">${escHtml(project.id)}</div>
          </div>
          <div class="actions">
            <a href="/admin/projects"><button type="button" class="link">← Voltar</button></a>
          </div>
        </div>

        <div class="card" style="margin-top:12px;">
          <form method="post" action="/admin/projects/${escHtml(project.id)}/save">
            <div class="row">
              <div>
                <label>Nome *</label>
                <input name="name" required value="${escHtml(project.name)}" />
              </div>
              <div>
                <label>Status</label>
                <select name="status">
                  <option value="active" ${project.status === "active" ? "selected" : ""}>active</option>
                  <option value="concluded" ${project.status === "concluded" ? "selected" : ""}>concluded</option>
                </select>
              </div>
            </div>
            <div style="margin-top:12px;">
              <label>Descrição</label>
              <textarea name="description">${escHtml(project.description ?? "")}</textarea>
            </div>
            <div class="row" style="margin-top:12px;">
              <div>
                <label>End date</label>
                <input type="date" name="endDateIso" value="${escHtml(
                  project.endDate ? fmtDate(project.endDate) : ""
                )}" />
              </div>
              <div>
                <label>Criado por (Slack ID)</label>
                <input name="createdBySlackId" value="${escHtml(project.createdBySlackId ?? "")}" />
              </div>
            </div>
            <div class="actions">
              <button type="submit">Salvar</button>
              <button type="submit" name="action" value="delete_project" class="danger">Deletar projeto</button>
            </div>
            <div class="small" style="margin-top:12px;">${project._count.tasks} tasks • ${project._count.members} members</div>
          </form>
        </div>

        <h2>Membros</h2>
        <div class="card">
          <form method="post" action="/admin/projects/${escHtml(project.id)}/members" style="margin-bottom:12px;">
            <div class="row">
              <div>
                <label>Adicionar slackUserId</label>
                <input name="add" placeholder="U123..." />
              </div>
              <div>
                <label>Remover slackUserId</label>
                <input name="remove" placeholder="U123..." />
              </div>
            </div>
            <div class="actions"><button type="submit">Aplicar</button></div>
            <div class="small">Obs: regra do sistema adiciona membros automaticamente via tasks; aqui é admin override.</div>
          </form>
          <div style="overflow:auto;">
            <table>
              <thead><tr><th>Membro</th><th>email</th><th>createdAt</th></tr></thead>
              <tbody>${membersRows || `<tr><td colspan="3" class="muted">Sem membros.</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      `;

      reply
        .type("text/html")
        .send(layout({ title: "FTA Admin - Project", user, flash, body }));
    });

    protectedApp.post("/admin/projects/:id/save", async (request, reply) => {
      const id = pickString((request.params as any)?.id);
      const body = request.body as any;
      const action = pickString(body?.action);

      if (action === "delete_project") {
        await prisma.project.delete({ where: { id } }).catch(() => null);
        return redirectWithFlash(reply, "/admin/projects", {
          kind: "ok",
          message: "Projeto deletado",
        });
      }

      const name = pickString(body?.name);
      const description = pickString(body?.description) || null;
      const status = normalizeProjectStatus(body?.status);
      const endDateIso = pickString(body?.endDateIso);
      const createdBySlackId = pickString(body?.createdBySlackId) || null;
      const endDate = endDateIso ? dateIsoToSpMidnightUtc(endDateIso) : null;

      if (!name) {
        return redirectWithFlash(reply, `/admin/projects/${id}`, {
          kind: "err",
          message: "Nome é obrigatório",
        });
      }

      await prisma.project.update({
        where: { id },
        data: {
          name,
          description,
          status,
          endDate,
          createdBySlackId,
          concludedAt: status === "concluded" ? new Date() : null,
        },
      });

      return redirectWithFlash(reply, `/admin/projects/${id}`, {
        kind: "ok",
        message: "Salvo",
      });
    });

    protectedApp.post("/admin/projects/:id/members", async (request, reply) => {
      const id = pickString((request.params as any)?.id);
      const body = request.body as any;
      const add = pickString(body?.add);
      const remove = pickString(body?.remove);

      if (remove) {
        await prisma.projectMember.deleteMany({
          where: { projectId: id, slackUserId: remove },
        });
      }
      if (add) {
        await prisma.projectMember
          .create({ data: { projectId: id, slackUserId: add, email: null } })
          .catch(() => null);
      }

      return redirectWithFlash(reply, `/admin/projects/${id}`, {
        kind: "ok",
        message: "Membros atualizados",
      });
    });
  });
}
