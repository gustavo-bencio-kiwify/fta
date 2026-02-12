// src/services/syncTaskParticipantEmails.ts
import type { WebClient } from "@slack/web-api";
import { prisma } from "../lib/prisma";

const slackEmailCache = new Map<string, string | null>();

async function getSlackUserEmail(slack: WebClient, userId: string): Promise<string | null> {
  if (!userId) return null;
  if (slackEmailCache.has(userId)) return slackEmailCache.get(userId)!;

  try {
    const res = await slack.users.info({ user: userId });
    const email = (res.user as any)?.profile?.email;
    const finalEmail = typeof email === "string" && email.includes("@") ? email : null;
    slackEmailCache.set(userId, finalEmail);
    return finalEmail;
  } catch {
    slackEmailCache.set(userId, null);
    return null;
  }
}

export async function syncTaskParticipantEmails(args: {
  slack: WebClient;
  taskId: string;
  delegationSlackId: string;
  responsibleSlackId: string;
  carbonCopiesSlackIds: string[];
}) {
  const { slack, taskId, delegationSlackId, responsibleSlackId, carbonCopiesSlackIds } = args;

  const [delegationEmail, responsibleEmail] = await Promise.all([
    getSlackUserEmail(slack, delegationSlackId),
    getSlackUserEmail(slack, responsibleSlackId),
  ]);

  await prisma.task.update({
    where: { id: taskId },
    data: {
      delegationEmail: delegationEmail ?? null,
      responsibleEmail: responsibleEmail ?? null,
    },
  });

  const ccIds = Array.from(new Set((carbonCopiesSlackIds ?? []).filter(Boolean)));
  if (!ccIds.length) return;

  const emails = await Promise.all(ccIds.map((id) => getSlackUserEmail(slack, id)));

  await Promise.allSettled(
    ccIds.map((slackUserId, i) =>
      prisma.taskCarbonCopy.updateMany({
        where: { taskId, slackUserId },
        data: { email: emails[i] ?? null },
      })
    )
  );
}
