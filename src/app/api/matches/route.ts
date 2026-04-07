import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { formatRuDate } from "@/lib/date";

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

function toInt(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }

  return fallback;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      uploadedAtIso?: string;
      playedOnIso?: string;
      mapName?: string;
      scoreA?: number;
      scoreB?: number;
      seasonId?: string | null;
      teams?: Array<{
        name?: string;
        side?: string;
        score?: number;
        players?: Array<{
          nickname?: string;
          kills?: number;
          deaths?: number;
          assists?: number | null;
          damage?: number;
          headshotPct?: number;
        }>;
      }>;
    };

    if (!body.mapName || !body.playedOnIso || !body.uploadedAtIso || !body.teams?.length) {
      return NextResponse.json({ error: "Недостаточно данных для сохранения", match: null }, { status: 400 });
    }

    const payload = {
      uploadedAt: new Date(body.uploadedAtIso),
      playedOn: new Date(body.playedOnIso),
      mapName: body.mapName,
      scoreA: toInt(body.scoreA, 0),
      scoreB: toInt(body.scoreB, 0),
      seasonId: body.seasonId || null,
      teams: body.teams.map((team) => ({
        name: team.name || "",
        side: team.side || "",
        score: toInt(team.score, 0),
        players: (team.players ?? []).map((player) => {
          const kills = toInt(player.kills, 0);
          const deaths = toInt(player.deaths, 0);

          return {
            nickname: player.nickname || "",
            kills,
            deaths,
            assists: player.assists == null ? null : toInt(player.assists, 0),
            damage: toInt(player.damage, 0),
            headshotPct: toInt(player.headshotPct, 0),
            kda: deaths === 0 ? kills : Math.round((kills / deaths) * 100) / 100
          };
        })
      }))
    };

    const include = {
      season: true,
      teams: {
        orderBy: {
          createdAt: "asc" as const
        },
        include: {
          players: true
        }
      }
    };

    let saved;
    if (body.id && body.id !== "preview") {
      await prisma.playerStat.deleteMany({
        where: {
          team: {
            matchId: body.id
          }
        }
      });

      await prisma.team.deleteMany({
        where: {
          matchId: body.id
        }
      });

      saved = await prisma.match.update({
        where: {
          id: body.id
        },
        data: {
          uploadedAt: payload.uploadedAt,
          playedOn: payload.playedOn,
          mapName: payload.mapName,
          scoreA: payload.scoreA,
          scoreB: payload.scoreB,
          seasonId: payload.seasonId,
          teams: {
            create: payload.teams.map((team) => ({
              name: team.name,
              side: team.side,
              score: team.score,
              players: {
                create: team.players
              }
            }))
          }
        },
        include
      });
    } else {
      saved = await prisma.match.create({
        data: {
          uploadedAt: payload.uploadedAt,
          playedOn: payload.playedOn,
          mapName: payload.mapName,
          scoreA: payload.scoreA,
          scoreB: payload.scoreB,
          seasonId: payload.seasonId,
          teams: {
            create: payload.teams.map((team) => ({
              name: team.name,
              side: team.side,
              score: team.score,
              players: {
                create: team.players
              }
            }))
          }
        },
        include
      });
    }

    return NextResponse.json({
      error: null,
      match: toClientMatch(saved)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Не удалось сохранить матч",
        match: null
      },
      { status: 500 }
    );
  }
}
