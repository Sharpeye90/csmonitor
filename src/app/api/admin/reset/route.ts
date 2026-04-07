import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST() {
  try {
    await prisma.$transaction([
      prisma.playerStat.deleteMany(),
      prisma.team.deleteMany(),
      prisma.match.deleteMany(),
      prisma.season.deleteMany()
    ]);

    return NextResponse.json({ error: null, ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось очистить базу" },
      { status: 500 }
    );
  }
}
