// src/scripts/createAdminUser.ts
// Uso:
//   npx tsx src/scripts/createAdminUser.ts --username admin --password "SUA_SENHA"
//   npx tsx src/scripts/createAdminUser.ts --username admin --password "NOVA" --reset

import { prisma } from "../lib/prisma";
import { hashPassword } from "../admin/password";

function arg(name: string) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const username = (arg("username") ?? "").trim();
  const password = (arg("password") ?? "").trim();
  const reset = hasFlag("reset");

  if (!username || !password) {
    console.error("Uso: npx tsx src/scripts/createAdminUser.ts --username <user> --password <pass> [--reset]");
    process.exit(1);
  }

  const passwordHash = hashPassword(password);

  const existing = await prisma.adminUser.findUnique({ where: { username }, select: { id: true } });

  if (existing && !reset) {
    console.error(`AdminUser '${username}' já existe. Use --reset para trocar a senha.`);
    process.exit(2);
  }

  if (existing && reset) {
    await prisma.adminUser.update({
      where: { id: existing.id },
      data: { passwordHash, isActive: true },
    });
    console.log(`Senha do admin '${username}' atualizada.`);
    return;
  }

  await prisma.adminUser.create({
    data: { username, passwordHash, isActive: true },
  });
  console.log(`Admin '${username}' criado com sucesso.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => void 0);
  });
