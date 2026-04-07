import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { formatRuDate, resolvePlayedOn } from "@/lib/date";
import { parseMatchScreenshot } from "@/lib/parse-match";
import { resolveSeasonForMatch } from "@/lib/seasons";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("screenshot");
    const seasonId = formData.get("seasonId");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Файл скриншота не передан", match: null }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadedAt = new Date();
    const timeZone = process.env.APP_TIMEZONE || "Europe/Moscow";
    const playedOn = resolvePlayedOn(uploadedAt, timeZone);
    const season = await resolveSeasonForMatch({
      seasonId: typeof seasonId === "string" && seasonId ? seasonId : null,
      playedOn
    });

    const parsed = await parseMatchScreenshot(buffer);

    const saved = await prisma.match.create({
      data: {
        seasonId: season?.id ?? null,
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
        season: true,
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
        season: saved.season
          ? {
              id: saved.season.id,
              name: saved.season.name,
              startDate: saved.season.startDate.toISOString(),
              endDate: saved.season.endDate.toISOString()
            }
          : null,
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
    const message = error instanceof Error ? error.message : "Внутренняя ошибка сервера";
    const details =
      error && typeof error === "object" && "details" in error
        ? (error as { details?: Record<string, string> }).details ?? null
        : null;

    return NextResponse.json(
      {
        error: message,
        details,
        match: null
      },
      { status: 500 }
    );
  }
}
