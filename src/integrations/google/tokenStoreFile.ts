import fs from "node:fs/promises";
import path from "node:path";

const TOKENS_PATH = path.join(process.cwd(), ".google_tokens.json");

export async function saveGoogleTokens(tokens: any) {
  await fs.writeFile(TOKENS_PATH, JSON.stringify(tokens, null, 2), "utf8");
}

export async function loadGoogleTokens(): Promise<any | null> {
  try {
    const raw = await fs.readFile(TOKENS_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
    