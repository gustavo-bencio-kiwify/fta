// src/services/createProjectService.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

export async function createProjectService(
  slack: WebClient,
  args: {
    name: string;
    description?: string | null;
    endDate?: Date | null;

    /**
     * ✅ Agora usamos no create:
     * - serve apenas para VISUALIZAÇÃO do projeto
     * - NÃO dá permissão de concluir (isso continua sendo só do criador)
     */
    memberSlackIds?: string[];

    createdBySlackId: string;
  }
) {
  const name = args.name.trim();
  const description = args.description?.trim() ? args.description.trim() : null;

  // ✅ membros com acesso (sem duplicados, sem vazio, sem incluir criador)
  const memberSlackIds = Array.from(
    new Set(
      (args.memberSlackIds ?? [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean)
        .filter((id) => id !== args.createdBySlackId)
    )
  );

  // 1) cria projeto + membros de acesso (visualização)
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        name,
        description,
        endDate: args.endDate ?? null,
        // ✅ criador
        createdBySlackId: args.createdBySlackId,
      },
      select: { id: true, name: true },
    });

    if (memberSlackIds.length) {
      await tx.projectMember.createMany({
        data: memberSlackIds.map((slackUserId) => ({
          projectId: created.id,
          slackUserId,
        })),
        skipDuplicates: true,
      });
    }

    return created;
  });

  // 2) ✅ DM apenas para quem criou (mantido)
  const text = `📁 *Projeto criado:* *${project.name}*`;

  try {
    const opened = await slack.conversations.open({ users: args.createdBySlackId });
    const channelId = opened.channel?.id;
    if (channelId) {
      await slack.chat.postMessage({ channel: channelId, text });
    }
  } catch {
    // ignore
  }

  return project;
}