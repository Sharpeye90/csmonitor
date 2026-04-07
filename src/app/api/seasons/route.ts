import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";

function dateOnlyToUtc(value: string, endOfDay = false) {
  if (!value) {
    throw new Error("Дата сезона обязательна");
  }

  return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
}

export async function GET() {
  const seasons = await prisma.season.findMany({
    orderBy: {
      startDate: "desc"
    }
  });

  return NextResponse.json({
    seasons
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      startDate?: string;
      endDate?: string;
    };

    const name = body.name?.trim();
    const startDate = dateOnlyToUtc(body.startDate ?? "");
    const endDate = dateOnlyToUtc(body.endDate ?? "", true);

    if (!name) {
      return NextResponse.json({ error: "Название сезона обязательно" }, { status: 400 });
    }

    if (endDate < startDate) {
      return NextResponse.json({ error: "Дата окончания сезона раньше даты начала" }, { status: 400 });
    }

    const season = await prisma.season.create({
      data: {
        name,
        startDate,
        endDate
      }
    });

    return NextResponse.json({ error: null, season });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось создать сезон" },
      { status: 500 }
    );
  }
}
