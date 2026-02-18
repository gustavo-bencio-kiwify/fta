import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// cache em memória (reinicia quando reiniciar o server)
const cache = new Map<string, { name: string; ts: number }>();
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

function pickDisplayName(u: any, fallback: string) {
  return (
    u?.profile?.display_name ||
    u?.profile?.real_name ||
    u?.real_name ||
    u?.name ||
    fallback
  );
}

export async function getSlackUserName(slackUserId: string) {
  const id = (slackUserId || "").trim();
  if (!id) return "";

  const hit = cache.get(id);
  if (hit && Date.now() - hit.ts < TTL_MS) return hit.name;

  try {
    const res = await slack.users.info({ user: id });
    const u = (res as any)?.user;
    const name = pickDisplayName(u, id);
    cache.set(id, { name, ts: Date.now() });
    return name;
  } catch {
    // evita ficar chamando em loop quando não tem permissão
    cache.set(id, { name: id, ts: Date.now() });
    return id;
  }
}

export async function resolveManySlackNames(ids: string[]) {
  const unique = Array.from(new Set(ids.map((s) => (s ?? "").trim()).filter(Boolean)));
  const out: Record<string, string> = {};

  // limite de concorrência pra não estourar rate limit
  const CONCURRENCY = 5;
  let i = 0;

  async function worker() {
    while (i < unique.length) {
      const id = unique[i++];
      out[id] = await getSlackUserName(id);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, worker));
  return out;
}