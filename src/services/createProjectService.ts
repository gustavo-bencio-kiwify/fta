// src/services/createProjectService.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

export async function createProjectService(
  slack: WebClient,
  args: {
    name: string;
    description?: string | null;
    endDate?: Date | null;
    memberSlackIds?: string[];
    createdBySlackId: string;
  }
) {
  const memberSlackIds = Array.from(
    new Set([...(args.memberSlackIds ?? []), args.createdBySlackId].filter(Boolean))
  );

  // 1) cria o projeto
  const project = await prisma.project.create({
    data: {
      name: args.name.trim(),
      description: args.description?.trim() ? args.description.trim() : null,
      endDate: args.endDate ?? null,

      // ✅ criador (precisa existir no schema do Prisma)
      createdBySlackId: args.createdBySlackId,
    },
    select: { id: true, name: true },
  });

  // 2) cria membros (garante que existe row em project-members)
  if (memberSlackIds.length) {
    await prisma.projectMember.createMany({
      data: memberSlackIds.map((slackUserId) => ({
        projectId: project.id,
        slackUserId,
      })),
      skipDuplicates: true,
    });
  }

  // 3) notifica via DM (sem quebrar se falhar)
  const text = `📁 *Projeto criado:* *${project.name}*`;

  await Promise.allSettled(
    memberSlackIds.map(async (userId) => {
      try {
        const opened = await slack.conversations.open({ users: userId });
        const channelId = opened.channel?.id;
        if (!channelId) return;
        await slack.chat.postMessage({ channel: channelId, text });
      } catch {
        // ignore
      }
    })
  );

  return project;
}
