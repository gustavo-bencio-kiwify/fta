// src/services/sendImportTemplateDm.ts
import type { WebClient } from "@slack/web-api";
import fs from "node:fs";
import path from "node:path";

async function openDm(slack: WebClient, userId: string) {
  const conv = await slack.conversations.open({ users: userId });
  const channelId = conv.channel?.id;
  if (!channelId) throw new Error("Could not open DM channel");
  return channelId;
}

export async function sendImportTemplateDm(slack: WebClient, userSlackId: string) {
  const channelId = await openDm(slack, userSlackId);

  const filePath = path.join(process.cwd(), "src", "assets", "tasks_import_template.xlsx");
  const fileBuf = fs.readFileSync(filePath);

  // Upload do arquivo (Slack mostra o arquivo clicável pra download)
  await slack.files.uploadV2({
    channel_id: channelId,
    filename: "tasks_import_template.xlsx",
    file: fileBuf,
    title: "Template de importação de tasks",
    initial_comment:
      "📎 Aqui está o *template*.\n" +
      "Depois é só *anexar o .xlsx neste DM* que eu processo e crio as tasks.",
  });

  // (Opcional) mandar uma mensagem extra com instruções
  await slack.chat.postMessage({
    channel: channelId,
    text:
      "✅ Envie o arquivo .xlsx aqui no DM.\n" +
      "Eu vou ler as linhas e criar as tasks automaticamente.",
  });
}
