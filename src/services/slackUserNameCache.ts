// src/services/slackUserNameCache.ts
import type { WebClient } from "@slack/web-api";

const slackNameCache = new Map<string, string>();

export async function getSlackDisplayName(slack: WebClient, userId: string): Promise<string> {
  if (!userId) return "";
  if (slackNameCache.has(userId)) return slackNameCache.get(userId)!;

  try {
    const res = await slack.users.info({ user: userId });
    const u: any = res.user;

    const name =
      (u?.profile?.display_name as string) ||
      (u?.profile?.real_name as string) ||
      (u?.real_name as string) ||
      (u?.name as string) ||
      userId;

    const finalName = String(name).trim() || userId;
    slackNameCache.set(userId, finalName);
    return finalName;
  } catch {
    // comum: missing_scope users:read ou user desativado
    slackNameCache.set(userId, userId);
    return userId;
  }
}

// util pra resolver vários de uma vez e devolver Map
export async function resolveSlackNames(slack: WebClient, ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, string>();

  await Promise.all(
    unique.map(async (id) => {
      map.set(id, await getSlackDisplayName(slack, id));
    })
  );

  return map;
}
