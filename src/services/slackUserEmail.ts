// src/services/slackUserEmail.ts
import { WebClient } from "@slack/web-api";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const slack = new WebClient(mustEnv("SLACK_BOT_TOKEN"));

export async function getSlackUserEmail(slackUserId: string): Promise<string | null> {
  // Se você estiver salvando nome ao invés de ID, não dá pra buscar email
  if (!slackUserId || !/^U[A-Z0-9]+$/.test(slackUserId)) return null;

  const res = await slack.users.info({ user: slackUserId });

  const email = (res.user as any)?.profile?.email;
  return typeof email === "string" && email.includes("@") ? email : null;
}
