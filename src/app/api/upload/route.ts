import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { formatRuDate, resolvePlayedOn } from "@/lib/date";
import { parseMatchScreenshot } from "@/lib/parse-match";
import { resolveSeasonForMatch } from "@/lib/seasons";
import type { ParsePreview } from "@/lib/types";

export const runtime = "nodejs";

function toClientMatch(input: {
  id: string;
  uploadedAt: Date;
  playedOn: Date;
  mapName: string;
  scoreA: number;
  scoreB: number;
  season:
    | {
        id: string;
        name: string;
        startDate: Date;
        endDate: Date;
      }
    | null;
  teams: Array<{
    name: string;
    side: string;
    score: number;
    players: Array<{
      nickname: string;
      kills: number;
      deaths: number;
      assists: number | null;
      damage: number;
      headshotPct: number;
      kda: number;
    }>;
  }>;
}) {
  const timeZone = process.env.APP_TIMEZONE || "Europe/Moscow";

  return {
    id: input.id,
    uploadedAt: input.uploadedAt.toISOString(),
    uploadedAtIso: input.uploadedAt.toISOString(),
    playedOn: formatRuDate(input.playedOn, timeZone),
    playedOnIso: input.playedOn.toISOString(),
    mapName: input.mapName,
    scoreA: input.scoreA,
    scoreB: input.scoreB,
    season: input.season
      ? {
          id: input.season.id,
          name: input.season.name,
          startDate: input.season.startDate.toISOString(),
          endDate: input.season.endDate.toISOString()
        }
      : null,
    teams: input.teams.map((team) => ({
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
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("screenshot");
    const seasonId = formData.get("seasonId");
    const testMode = formData.get("testMode") === "on";

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
    const preview: ParsePreview = {
      mapName: parsed.mapName,
      scoreA: parsed.scoreA,
      scoreB: parsed.scoreB,
      teams: parsed.teams
    };

    if (testMode) {
      return NextResponse.json({
        error: null,
        details: {
          parsedPreview: JSON.stringify(preview, null, 2),
          ...(parsed.diagnostics ?? {})
        },
        match: toClientMatch({
          id: "preview",
          uploadedAt,
          playedOn,
          mapName: parsed.mapName,
          scoreA: parsed.scoreA,
          scoreB: parsed.scoreB,
          season: season
            ? {
                id: season.id,
                name: season.name,
                startDate: season.startDate,
                endDate: season.endDate
              }
            : null,
          teams: parsed.teams
        }),
        testMode: true
      });
    }

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
      details: {
        parsedPreview: JSON.stringify(preview, null, 2),
        ...(parsed.diagnostics ?? {})
      },
      match: toClientMatch(saved),
      testMode: false
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
