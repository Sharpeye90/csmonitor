import OpenAI from "openai";

import type { ParsedPlayer, ParsedTeam } from "@/lib/types";

type VisionPlayer = {
  nickname: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshotPct: number;
};

type VisionTeam = {
  name: string;
  side: string;
  score: number;
  players: VisionPlayer[];
};

type VisionMatch = {
  mapName: string;
  score: string;
  teams: VisionTeam[];
};

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["mapName", "score", "teams"],
  properties: {
    mapName: { type: "string" },
    score: {
      type: "string",
      description: "Final score in format A-B, for example 13-2"
    },
    teams: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "side", "score", "players"],
        properties: {
          name: { type: "string" },
          side: { type: "string" },
          score: { type: "integer" },
          players: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["nickname", "kills", "deaths", "assists", "damage", "headshotPct"],
              properties: {
                nickname: { type: "string" },
                kills: { type: "integer" },
                deaths: { type: "integer" },
                assists: { type: "integer" },
                damage: { type: "integer" },
                headshotPct: { type: "number" }
              }
            }
          }
        }
      }
    }
  }
} as const;

function normalizePlayer(player: {
  nickname: string;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  headshotPct: number;
}): ParsedPlayer {
  const kills = Number(player.kills) || 0;
  const deaths = Number(player.deaths) || 0;

  return {
    nickname: player.nickname.trim(),
    kills,
    deaths,
    assists: Number.isFinite(player.assists) ? Number(player.assists) : null,
    damage: Number(player.damage) || 0,
    headshotPct: Number(player.headshotPct) || 0,
    kda: `${kills}/${deaths}`
  };
}

function normalizeTeams(teams: VisionTeam[], scoreA: number, scoreB: number): ParsedTeam[] {
  return teams.slice(0, 2).map((team, index) => ({
    name: team.name?.trim() || (index === 0 ? "Team A" : "Team B"),
    side: team.side?.trim() || (index === 0 ? "UNKNOWN" : "UNKNOWN"),
    score: Number.isFinite(team.score) ? Number(team.score) : index === 0 ? scoreA : scoreB,
    players: (team.players ?? []).map(normalizePlayer)
  }));
}

export function parseScore(score: string) {
  const match = score.match(/(\d+)\s*[-:]\s*(\d+)/);

  if (!match) {
    throw new Error(`Не удалось разобрать счет: ${score}`);
  }

  return {
    scoreA: Number(match[1]),
    scoreB: Number(match[2])
  };
}

export async function parseMatchScreenshot(input: { mimeType: string; base64Image: string }) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY не задан");
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const response = await client.responses.create({
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "You extract CS2 match statistics from a scoreboard screenshot.",
              "Return only the visible final match data.",
              "Map name must be plain text such as Dust II or Mirage.",
              "Score must be final match score in A-B format.",
              "Create exactly two teams, ordered from the upper scoreboard block to the lower one.",
              "If a team name is not shown, use CT for counter-terrorists and T for terrorists.",
              "Players must belong to the correct team.",
              "Headshot percentage comes from the %HS column.",
              "Assists are taken from the assists column if visible; otherwise return 0.",
              "Do not invent players that are not visible."
            ].join(" ")
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Parse this CS2 screenshot into structured JSON."
          },
          {
            type: "input_image",
            image_url: `data:${input.mimeType};base64,${input.base64Image}`,
            detail: "auto"
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "cs2_match_parse",
        schema: responseSchema
      }
    }
  });

  const parsed = JSON.parse(response.output_text) as VisionMatch;
  const { scoreA, scoreB } = parseScore(parsed.score);

  return {
    ...parsed,
    teams: normalizeTeams(parsed.teams, scoreA, scoreB),
    scoreA,
    scoreB
  };
}
