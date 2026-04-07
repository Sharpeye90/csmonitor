import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ParsedPlayer, ParsedTeam } from "@/lib/types";

const execFileAsync = promisify(execFile);

const KNOWN_MAPS = [
  { canonical: "Dust II", aliases: ["dust ii", "dust 2", "dustii"] },
  { canonical: "Mirage", aliases: ["mirage"] },
  { canonical: "Inferno", aliases: ["inferno"] },
  { canonical: "Nuke", aliases: ["nuke"] },
  { canonical: "Ancient", aliases: ["ancient"] },
  { canonical: "Anubis", aliases: ["anubis"] },
  { canonical: "Train", aliases: ["train"] },
  { canonical: "Vertigo", aliases: ["vertigo"] },
  { canonical: "Overpass", aliases: ["overpass"] }
];

function normalizeText(input: string) {
  return input
    .replace(/[|]/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/[^\S\r\n]+/g, " ");
}

function cleanNickname(raw: string) {
  return raw
    .replace(/^\s*\d{1,3}\s+/g, "")
    .replace(/^\s*[\W_]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function findMapName(text: string) {
  const normalized = text.toLowerCase();

  for (const map of KNOWN_MAPS) {
    if (map.aliases.some((alias) => normalized.includes(alias))) {
      return map.canonical;
    }
  }

  const previewModeMap = normalized.match(/(?:premier|премьер)[^\n]*?([a-z]+(?:\s*(?:ii|2))?)/i);
  if (previewModeMap?.[1]) {
    return previewModeMap[1].trim();
  }

  return "Unknown";
}

function parseScoreFromText(text: string) {
  const matches = Array.from(text.matchAll(/(\d{1,2})\s*[-:]\s*(\d{1,2})/g));
  const candidates = matches
    .map((match) => ({
      scoreA: Number(match[1]),
      scoreB: Number(match[2])
    }))
    .filter((item) => item.scoreA <= 30 && item.scoreB <= 30);

  if (!candidates.length) {
    throw new Error("Не удалось распознать итоговый счет на скриншоте");
  }

  return candidates.sort((left, right) => right.scoreA + right.scoreB - (left.scoreA + left.scoreB))[0];
}

function parsePlayerLine(line: string): ParsedPlayer | null {
  const normalized = line.replace(/[^\S\r\n]+/g, " ").trim();
  const match = normalized.match(/^(.*?)(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,3})\s+(\d{2,5})$/);

  if (!match) {
    return null;
  }

  const nickname = cleanNickname(match[1]);
  const kills = Number(match[2]);
  const deaths = Number(match[3]);
  const assists = Number(match[4]);
  const headshotPct = Number(match[5]);
  const damage = Number(match[6]);

  if (!nickname || damage < 100 || kills > 60 || deaths > 60) {
    return null;
  }

  return {
    nickname,
    kills,
    deaths,
    assists,
    damage,
    headshotPct,
    kda: `${kills}/${deaths}`
  };
}

function parsePlayers(lines: string[]) {
  const players = lines
    .map(parsePlayerLine)
    .filter((player): player is ParsedPlayer => player !== null);

  if (players.length < 2) {
    throw new Error("Не удалось распознать строки игроков. Проверьте качество скриншота.");
  }

  const midpoint = Math.ceil(players.length / 2);
  const topPlayers = players.slice(0, midpoint);
  const bottomPlayers = players.slice(midpoint);

  return { topPlayers, bottomPlayers };
}

function buildTeams(players: { topPlayers: ParsedPlayer[]; bottomPlayers: ParsedPlayer[] }, scoreA: number, scoreB: number): ParsedTeam[] {
  return [
    {
      name: "Спецназ",
      side: "CT",
      score: scoreA,
      players: players.topPlayers
    },
    {
      name: "Террористы",
      side: "T",
      score: scoreB,
      players: players.bottomPlayers
    }
  ];
}

async function runTesseract(buffer: Buffer) {
  const tesseractBin = process.env.TESSERACT_BIN || "tesseract";
  const ocrLang = process.env.OCR_LANG || "eng+rus";
  const tempPath = join(tmpdir(), `${randomUUID()}.png`);

  await writeFile(tempPath, buffer);

  try {
    const { stdout, stderr } = await execFileAsync(tesseractBin, [
      tempPath,
      "stdout",
      "-l",
      ocrLang,
      "--psm",
      "6"
    ]);

    const text = normalizeText(stdout);

    if (!text.trim()) {
      throw new Error(stderr || "tesseract не вернул текст");
    }

    return text;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(
        `Локальный OCR не сработал. Убедитесь, что установлен tesseract и языки ${ocrLang}. ${error.message}`
      );
    }

    throw error;
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

export async function parseMatchScreenshot(buffer: Buffer) {
  const text = await runTesseract(buffer);
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const { scoreA, scoreB } = parseScoreFromText(text);
  const mapName = findMapName(text);
  const players = parsePlayers(lines);

  return {
    mapName,
    score: `${scoreA}-${scoreB}`,
    scoreA,
    scoreB,
    teams: buildTeams(players, scoreA, scoreB)
  };
}
