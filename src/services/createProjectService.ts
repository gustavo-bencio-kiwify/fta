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
     * ⚠️ Mantido só por compatibilidade com chamadas antigas,
     * mas NÃO usamos mais no create (regra do produto):
     * - ninguém entra no projeto "na mão" no momento da criação
     * - só entra quando uma task do projeto envolver a pessoa
     */
    memberSlackIds?: string[];

    createdBySlackId: string;
  }
) {
  // 1) cria o projeto
  const project = await prisma.project.create({
    data: {
      name: args.name.trim(),
      description: args.description?.trim() ? args.description.trim() : null,
      endDate: args.endDate ?? null,

      // ✅ criador
      createdBySlackId: args.createdBySlackId,
    },
    select: { id: true, name: true },
  });

  // 2) ✅ garante que o CRIADOR aparece na lista de projetos
  // (mesmo que nenhuma task esteja vinculada ao projeto ainda)

  // 3) ✅ DM apenas para quem criou (não notifica "membros" agora)
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
