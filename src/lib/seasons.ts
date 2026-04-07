import { prisma } from "@/lib/db";

export async function resolveSeasonForMatch(input: { seasonId?: string | null; playedOn: Date }) {
  if (input.seasonId) {
    const season = await prisma.season.findUnique({
      where: {
        id: input.seasonId
      }
    });

    if (!season) {
      throw new Error("Выбранный сезон не найден");
    }

    return season;
  }

  return prisma.season.findFirst({
    where: {
      startDate: {
        lte: input.playedOn
      },
      endDate: {
        gte: input.playedOn
      }
    },
    orderBy: {
      startDate: "desc"
    }
  });
}
