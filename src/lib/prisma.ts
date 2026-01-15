import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!, // no Render: Internal DB URL
});

export const prisma = new PrismaClient({
  adapter,
  log: ["query"],
});
