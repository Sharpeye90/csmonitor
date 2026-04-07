import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.playerStat.deleteMany();
  await prisma.team.deleteMany();
  await prisma.match.deleteMany();
  await prisma.season.deleteMany();
  console.log("Database cleared.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
