// src/services/slackDownloadFile.ts
import type { WebClient } from "@slack/web-api";

export async function slackDownloadFile(slack: WebClient, fileId: string): Promise<Buffer> {
  const info = await slack.files.info({ file: fileId });
  const file = (info as any)?.file;

  const url: string | undefined = file?.url_private_download ?? file?.url_private;
  if (!url) throw new Error("No url_private_download/url_private on file");

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("Missing SLACK_BOT_TOKEN");

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Failed to download file: ${res.status} ${res.statusText}`);

  const ab = await res.arrayBuffer();
  return Buffer.from(new Uint8Array(ab)); // ✅ evita typing estranho
}
