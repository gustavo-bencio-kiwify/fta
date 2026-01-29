import type { WebClient } from "@slack/web-api";

export async function getSlackUserEmail(slack: WebClient, userId: string): Promise<string | null> {
  try {
    const res = await slack.users.info({ user: userId });
    const email = (res.user as any)?.profile?.email;
    return typeof email === "string" && email.includes("@") ? email : null;
  } catch {
    return null;
  }
}
