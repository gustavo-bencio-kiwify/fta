// src/services/notifyProjectCreated.ts
import type { WebClient } from "@slack/web-api";

type NotifyProjectCreatedArgs = {
  slack: WebClient;
  projectName: string;
  createdBy: string;
  memberSlackIds?: string[];
};

async function openDmMany(slack: WebClient, userIds: string[]) {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (!unique.length) throw new Error("No users to open DM");

  const conv = await slack.conversations.open({ users: unique.join(",") });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM channel");
  return channelId;
}

async function openDmOne(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM channel");
  return channelId;
}

export async function notifyProjectCreated(args: NotifyProjectCreatedArgs) {
  const { slack, projectName, createdBy, memberSlackIds = [] } = args;

  const participants = Array.from(new Set([createdBy, ...memberSlackIds].filter(Boolean)));

  const text = `📂 Projeto *${projectName}* criado.`;

  try {
    const channelId = await openDmMany(slack, participants);
    await slack.chat.postMessage({ channel: channelId, text });
  } catch {
    // fallback individual
    await Promise.all(
      participants.map(async (uid) => {
        try {
          const ch = await openDmOne(slack, uid);
          await slack.chat.postMessage({ channel: ch, text });
        } catch {
          // ignora erro individual
        }
      })
    );
  }
}
