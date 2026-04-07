import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { formatRuDate, resolvePlayedOn } from "@/lib/date";
import { parseMatchScreenshot } from "@/lib/parse-match";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("screenshot");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл скриншота не передан", match: null }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Image = buffer.toString("base64");
    const uploadedAt = new Date();
    const timeZone = process.env.APP_TIMEZONE || "Europe/Moscow";
    const playedOn = resolvePlayedOn(uploadedAt, timeZone);

    const parsed = await parseMatchScreenshot({
      mimeType: file.type || "image/jpeg",
      base64Image
    });

    const saved = await prisma.match.create({
      data: {
        uploadedAt,
        playedOn,
        mapName: parsed.mapName,
        scoreA: parsed.scoreA,
        scoreB: parsed.scoreB,
        teams: {
          create: parsed.teams.map((team) => ({
            name: team.name,
            side: team.side,
            score: team.score,
            players: {
              create: team.players.map((player) => ({
                nickname: player.nickname,
                kills: player.kills,
                deaths: player.deaths,
                assists: player.assists,
                kda: player.kda,
                damage: player.damage,
                headshotPct: player.headshotPct
              }))
            }
          }))
        }
      },
      include: {
        teams: {
          include: {
            players: {
              orderBy: {
                kills: "desc"
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });

    return NextResponse.json({
      error: null,
      match: {
        id: saved.id,
        uploadedAt: saved.uploadedAt.toISOString(),
        playedOn: formatRuDate(saved.playedOn, timeZone),
        mapName: saved.mapName,
        scoreA: saved.scoreA,
        scoreB: saved.scoreB,
        teams: saved.teams.map((team) => ({
          name: team.name,
          side: team.side,
          score: team.score,
          players: team.players.map((player) => ({
            nickname: player.nickname,
            kills: player.kills,
            deaths: player.deaths,
            assists: player.assists,
            damage: player.damage,
            headshotPct: player.headshotPct,
            kda: player.kda
          }))
        }))
      }
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Внутренняя ошибка сервера",
        match: null
      },
      { status: 500 }
    );
  }
}
