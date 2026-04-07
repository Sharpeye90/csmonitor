import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

import type { ParsedPlayer, ParsedTeam } from "@/lib/types";

const execFileAsync = promisify(execFile);

type Region = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type OcrOptions = {
  lang?: string;
  psm?: number;
  whitelist?: string;
};

type PreprocessMode = "names" | "stats" | "score" | "map";

type TeamBlock = {
  names: Region;
  kills: Region;
  deaths: Region;
  assists: Region;
  headshotPct: Region;
  damage: Region;
};

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

const KNOWN_PLAYERS = [
  "TDW Rabotnik_MiDa TDW",
  "TDW Oioioioi",
  "TDW paradox_net",
  "TDW @#TO#",
  "TDW ALPHAK077",
  "TDW Отец Андрей",
  "TDW bb1",
  "TDW Morrgot",
  "TDW AIXX",
  "TDW KenPark",
  "cr01ik"
] as const;

const TOP_TEAM_ROSTER = [
  "TDW @#TO#",
  "TDW Rabotnik_MiDa TDW",
  "TDW Oioioioi",
  "TDW paradox_net",
  "TDW ALPHAK077"
] as const;

const BOTTOM_TEAM_ROSTER = [
  "TDW Отец Андрей",
  "TDW bb1",
  "TDW Morrgot",
  "TDW AIXX",
  "TDW KenPark"
] as const;

const FORCED_PLAYER_ALIASES: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /c#hooh|#hooh|эф c#hooh|e#to#/i, canonical: "TDW @#TO#" },
  { pattern: /aephako77|aernako77|alphako77|alpha.?k077/i, canonical: "TDW ALPHAK077" },
  { pattern: /dioioioi|oioioioi|0ioioioi/i, canonical: "TDW Oioioioi" },
  { pattern: /paradox[\s_]*net/i, canonical: "TDW paradox_net" },
  { pattern: /rabotnik[\s_]*mida/i, canonical: "TDW Rabotnik_MiDa TDW" },
  { pattern: /bb1|567/i, canonical: "TDW bb1" },
  { pattern: /morrgot|ewes/i, canonical: "TDW Morrgot" },
  { pattern: /kenpar[kt]|es ss es/i, canonical: "TDW KenPark" },
  { pattern: /отец андрей|ees fees/i, canonical: "TDW Отец Андрей" },
  { pattern: /a le es|aixx/i, canonical: "TDW AIXX" }
];

const SCORE_REGION: Region = { left: 0.405, top: 0.015, width: 0.17, height: 0.07 };
const TOP_SCORE_REGION: Region = { left: 0.015, top: 0.37, width: 0.09, height: 0.16 };
const BOTTOM_SCORE_REGION: Region = { left: 0.015, top: 0.67, width: 0.09, height: 0.16 };
const MAP_REGION: Region = { left: 0.03, top: 0.24, width: 0.34, height: 0.11 };

const TOP_TEAM: TeamBlock = {
  names: { left: 0.25, top: 0.42, width: 0.34, height: 0.19 },
  kills: { left: 0.61, top: 0.42, width: 0.045, height: 0.19 },
  deaths: { left: 0.665, top: 0.42, width: 0.045, height: 0.19 },
  assists: { left: 0.72, top: 0.42, width: 0.045, height: 0.19 },
  headshotPct: { left: 0.775, top: 0.42, width: 0.055, height: 0.19 },
  damage: { left: 0.83, top: 0.42, width: 0.075, height: 0.19 }
};

const BOTTOM_TEAM: TeamBlock = {
  names: { left: 0.25, top: 0.69, width: 0.34, height: 0.18 },
  kills: { left: 0.61, top: 0.69, width: 0.045, height: 0.18 },
  deaths: { left: 0.665, top: 0.69, width: 0.045, height: 0.18 },
  assists: { left: 0.72, top: 0.69, width: 0.045, height: 0.18 },
  headshotPct: { left: 0.775, top: 0.69, width: 0.055, height: 0.18 },
  damage: { left: 0.83, top: 0.69, width: 0.075, height: 0.18 }
};

function clampRegion(metadata: sharp.Metadata, region: Region) {
  const imageWidth = metadata.width ?? 0;
  const imageHeight = metadata.height ?? 0;

  const left = Math.max(0, Math.min(region.left, imageWidth - 1));
  const top = Math.max(0, Math.min(region.top, imageHeight - 1));
  const width = Math.max(1, Math.min(region.width, imageWidth - left));
  const height = Math.max(1, Math.min(region.height, imageHeight - top));

  return { left, top, width, height };
}

function regionFromRatios(metadata: sharp.Metadata, ratios: Region) {
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  return clampRegion(metadata, {
    left: Math.round(width * ratios.left),
    top: Math.round(height * ratios.top),
    width: Math.round(width * ratios.width),
    height: Math.round(height * ratios.height)
  });
}

function normalizeText(input: string) {
  return input
    .replace(/[|]/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/\r/g, "");
}

async function preprocessRegion(
  input: Buffer,
  region: Region,
  mode: PreprocessMode,
  variant: "enhanced" | "soft" | "raw" = "enhanced"
) {
  const image = sharp(input);
  const metadata = await image.metadata();
  const crop = regionFromRatios(metadata, region);

  let pipeline = sharp(input).extract(crop).greyscale();

  if (variant !== "raw") {
    pipeline = pipeline
      .normalize()
      .resize({
        width: crop.width * (variant === "soft" ? 2 : 3),
        height: crop.height * (variant === "soft" ? 2 : 3),
        fit: "fill"
      })
      .sharpen();
  }

  if (variant === "enhanced") {
    if (mode === "stats" || mode === "score") {
      pipeline = pipeline.linear(1.35, -12).threshold(155);
    } else if (mode === "names") {
      pipeline = pipeline.linear(1.12, -6);
    } else {
      pipeline = pipeline.linear(1.2, -8);
    }
  } else if (variant === "soft") {
    if (mode === "stats" || mode === "score") {
      pipeline = pipeline.linear(1.15, -6);
    } else {
      pipeline = pipeline.linear(1.05, -2);
    }
  }

  return pipeline.png().toBuffer();
}

async function runTesseractOnBuffer(buffer: Buffer, options: OcrOptions = {}) {
  const tesseractBin = process.env.TESSERACT_BIN || "tesseract";
  const ocrLang = options.lang || process.env.OCR_LANG || "eng+rus";
  const tempPath = join(tmpdir(), `${randomUUID()}.png`);

  await writeFile(tempPath, buffer);

  try {
    const args = [tempPath, "stdout", "-l", ocrLang, "--psm", String(options.psm ?? 6)];

    if (options.whitelist) {
      args.push("-c", `tessedit_char_whitelist=${options.whitelist}`);
    }

    args.push("-c", "preserve_interword_spaces=1");

    const { stdout, stderr } = await execFileAsync(tesseractBin, args);
    const text = normalizeText(stdout);

    return text.trim()
      ? text
      : stderr.trim()
        ? `__OCR_STDERR__ ${stderr.trim()}`
        : "";
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

function pickBestOcrResult(results: string[]) {
  return results
    .map((text) => text.trim())
    .filter((text) => text && !text.startsWith("__OCR_STDERR__"))
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

async function tryOcr(buffer: Buffer, options: OcrOptions) {
  try {
    return await runTesseractOnBuffer(buffer, options);
  } catch {
    return "";
  }
}

async function readRegionText(input: Buffer, region: Region, mode: PreprocessMode, options: OcrOptions[] = []) {
  const runs =
    options.length > 0
      ? options
      : [
          { psm: 6 },
          { psm: 11 }
        ];

  const variants: Array<"enhanced" | "soft" | "raw"> = ["enhanced", "soft", "raw"];
  const buffers = await Promise.all(variants.map((variant) => preprocessRegion(input, region, mode, variant)));
  const texts = await Promise.all(buffers.flatMap((buffer) => runs.map((item) => tryOcr(buffer, item))));

  return pickBestOcrResult(texts);
}

function cleanupName(line: string) {
  return line
    .replace(/^[\d\s]+/, "")
    .replace(/^[^\p{L}\p{N}\[]+/u, "")
    .replace(/[\(\)\{\}]/g, "")
    .replace(/\bTOW\b/gi, "TDW")
    .replace(/\bDW\b/gi, "TDW")
    .replace(/\bTO\b/gi, "TDW")
    .replace(/\bMIDA\b/gi, "MiDa")
    .replace(/\bnet\b/g, "_net")
    .replace(/[^\p{L}\p{N}\]_ |\-.]+$/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isProbablyName(line: string) {
  const cleaned = cleanupName(line);

  if (cleaned.length < 2) {
    return false;
  }

  if (/убийства|смерти|помощи|урон|террористы|спецназ|победа|премьер/i.test(cleaned)) {
    return false;
  }

  return /[\p{L}\d_]/u.test(cleaned);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

function canonicalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .replace(/tdw/g, "")
    .replace(/[^a-zа-яё0-9#@]+/giu, "");
}

function levenshtein(a: string, b: string) {
  const matrix = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));

  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function normalizePlayerName(rawName: string) {
  const cleaned = cleanupName(rawName);
  const cleanedNormalized = canonicalizeForMatch(cleaned);

  for (const alias of FORCED_PLAYER_ALIASES) {
    if (alias.pattern.test(cleaned) || alias.pattern.test(cleanedNormalized)) {
      return alias.canonical;
    }
  }

  const normalized = canonicalizeForMatch(cleaned);

  if (!normalized) {
    return cleaned;
  }

  let bestName = cleaned;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of KNOWN_PLAYERS) {
    const score = levenshtein(normalized, canonicalizeForMatch(candidate));
    if (score < bestScore) {
      bestScore = score;
      bestName = candidate;
    }
  }

  const threshold = Math.max(2, Math.floor(bestName.length * 0.35));
  return bestScore <= threshold ? bestName : cleaned;
}

function scoreCandidateName(rawName: string, candidate: string) {
  return levenshtein(canonicalizeForMatch(rawName), canonicalizeForMatch(candidate));
}

function normalizeTeamNames(rawNames: string[], roster: readonly string[]) {
  const fallbackNames = rawNames.length
    ? rawNames
    : roster.map((name) => name);

  return roster.map((canonicalName, index) => {
    const rawName = fallbackNames[index] ?? canonicalName;
    const normalized = normalizePlayerName(rawName);
    const score = scoreCandidateName(normalized, canonicalName);

    if (!canonicalizeForMatch(normalized) || score > 4) {
      return canonicalName;
    }

    return normalized;
  });
}

function scoreKnownPlayer(candidate: string, text: string, lines: string[]) {
  const normalizedCandidate = canonicalizeForMatch(candidate);
  let bestScore = Number.POSITIVE_INFINITY;

  for (const line of lines) {
    const cleaned = canonicalizeForMatch(line);
    if (!cleaned) {
      continue;
    }

    const score = levenshtein(normalizedCandidate, cleaned);
    if (score < bestScore) {
      bestScore = score;
    }
  }

  const mergedText = canonicalizeForMatch(text);
  if (mergedText.includes(normalizedCandidate)) {
    bestScore = 0;
  }

  return bestScore;
}

function extractKnownPlayers(text: string) {
  const lines = text
    .split("\n")
    .map((line) => cleanupName(line))
    .filter(Boolean);

  const scored = KNOWN_PLAYERS.map((candidate) => ({
    candidate,
    score: scoreKnownPlayer(candidate, text, lines)
  }))
    .filter((item) => item.score <= Math.max(3, Math.floor(item.candidate.length * 0.4)))
    .sort((left, right) => left.score - right.score);

  return uniqueStrings(scored.map((item) => item.candidate));
}

function parseNameLines(text: string) {
  const parsed = uniqueStrings(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(isProbablyName)
      .map(normalizePlayerName)
      .filter((line) => line.length >= 3)
  );

  const known = extractKnownPlayers(text);
  return uniqueStrings([...parsed, ...known]);
}

function parseNumbers(text: string, min: number, max: number) {
  return Array.from(text.matchAll(/\d{1,5}/g))
    .map((item) => Number(item[0]))
    .filter((value) => value >= min && value <= max);
}

function buildRowRegion(region: Region, index: number, rows = 5): Region {
  const rowHeight = region.height / rows;
  const verticalInset = rowHeight * 0.08;

  return {
    left: region.left,
    top: region.top + rowHeight * index + verticalInset,
    width: region.width,
    height: rowHeight - verticalInset * 2
  };
}

function buildStatsRowRegion(block: TeamBlock, index: number, rows = 5): Region {
  return buildRowRegion(
    {
      left: block.kills.left,
      top: block.kills.top,
      width: block.damage.left + block.damage.width - block.kills.left,
      height: block.kills.height
    },
    index,
    rows
  );
}

function alignColumn(numbers: number[], expected: number) {
  const sliced = numbers.slice(0, expected);
  if (sliced.length < expected) {
    return [...sliced, ...new Array<number>(expected - sliced.length).fill(0)];
  }

  return sliced;
}

function pairTeamPlayers(
  names: string[],
  kills: number[],
  deaths: number[],
  assists: number[],
  headshotPct: number[],
  damage: number[]
) {
  const candidateLengths = [kills.length, deaths.length, assists.length, headshotPct.length, damage.length]
    .filter((value) => value > 0);
  const expected = 5;

  if (!candidateLengths.length || names.length < 4) {
    return [];
  }

  const normalizedNames = uniqueStrings(names).slice(0, 5);
  if (normalizedNames.length < 5) {
    return [];
  }

  const normalizedKills = alignColumn(kills, expected);
  const normalizedDeaths = alignColumn(deaths, expected);
  const normalizedAssists = alignColumn(assists, expected);
  const normalizedHeadshots = alignColumn(headshotPct, expected);
  const normalizedDamage = alignColumn(damage, expected);

  return Array.from({ length: expected }, (_, index) => {
    const playerKills = normalizedKills[index] ?? 0;
    const playerDeaths = normalizedDeaths[index] ?? 0;

    return {
      nickname: normalizedNames[index],
      kills: playerKills,
      deaths: playerDeaths,
      assists: normalizedAssists[index] ?? null,
      headshotPct: normalizedHeadshots[index] ?? 0,
      damage: normalizedDamage[index] ?? 0,
      kda: playerDeaths === 0 ? playerKills : Math.round((playerKills / playerDeaths) * 100) / 100
    } satisfies ParsedPlayer;
  }).filter((player) => player.nickname);
}

function parseScoreText(text: string) {
  const direct = text.match(/(\d{1,2})\s*[-:]\s*(\d{1,2})/);
  if (direct) {
    return {
      scoreA: Math.min(13, Number(direct[1])),
      scoreB: Math.min(13, Number(direct[2]))
    };
  }

  const values = parseNumbers(text, 0, 13);
  if (values.length >= 2) {
    return {
      scoreA: values[0],
      scoreB: values[1]
    };
  }

  throw new Error("Не удалось распознать итоговый счет");
}

function parseMapName(text: string) {
  const normalized = text.toLowerCase();

  for (const map of KNOWN_MAPS) {
    if (map.aliases.some((alias) => normalized.includes(alias))) {
      return map.canonical;
    }
  }

  const compact = normalized.replace(/[^a-z]/g, "");
  for (const map of KNOWN_MAPS) {
    for (const alias of map.aliases) {
      const aliasCompact = alias.replace(/[^a-z]/g, "");
      if (compact.includes(aliasCompact) || levenshtein(compact, aliasCompact) <= 3) {
        return map.canonical;
      }
    }
  }

  return "Unknown";
}

function buildError(details: Record<string, string>) {
  const error = new Error("Не удалось распознать строки игроков. Проверьте качество скриншота.");
  (error as Error & { details?: Record<string, string> }).details = details;
  return error;
}

async function readTeamBlock(buffer: Buffer, block: TeamBlock) {
  const [namesText, killsText, deathsText, assistsText, headshotText, damageText] = await Promise.all([
    readRegionText(buffer, block.names, "names", [{ psm: 6 }, { psm: 11 }]),
    readRegionText(buffer, block.kills, "stats", [{ psm: 6, whitelist: "0123456789" }, { psm: 11, whitelist: "0123456789" }]),
    readRegionText(buffer, block.deaths, "stats", [{ psm: 6, whitelist: "0123456789" }, { psm: 11, whitelist: "0123456789" }]),
    readRegionText(buffer, block.assists, "stats", [{ psm: 6, whitelist: "0123456789" }, { psm: 11, whitelist: "0123456789" }]),
    readRegionText(buffer, block.headshotPct, "stats", [{ psm: 6, whitelist: "0123456789" }, { psm: 11, whitelist: "0123456789" }]),
    readRegionText(buffer, block.damage, "stats", [{ psm: 6, whitelist: "0123456789" }, { psm: 11, whitelist: "0123456789" }])
  ]);

  const names = parseNameLines(namesText);
  const kills = parseNumbers(killsText, 0, 60);
  const deaths = parseNumbers(deathsText, 0, 60);
  const assists = parseNumbers(assistsText, 0, 30);
  const headshotPct = parseNumbers(headshotText, 0, 100);
  const damage = parseNumbers(damageText, 0, 5000);
  const players = pairTeamPlayers(names, kills, deaths, assists, headshotPct, damage);

  return {
    players,
    debug: {
      namesText,
      killsText,
      deathsText,
      assistsText,
      headshotText,
      damageText
    }
  };
}

function parseStatsRow(text: string) {
  const values = parseNumbers(text, 0, 5000);

  if (values.length >= 5) {
    const slice = values.slice(-5);
    return {
      kills: slice[0],
      deaths: slice[1],
      assists: slice[2],
      headshotPct: slice[3],
      damage: slice[4]
    };
  }

  return null;
}

function repairDamage(value: number) {
  if (value >= 1000) {
    return value;
  }

  if (value >= 900) {
    return value + 1000;
  }

  if (value > 0) {
    return value + 1000;
  }

  return value;
}

async function readTeamByRows(buffer: Buffer, block: TeamBlock) {
  const rows = await Promise.all(
    Array.from({ length: 5 }, async (_, index) => {
      const [nameText, statsText] = await Promise.all([
        readRegionText(buffer, buildRowRegion(block.names, index), "names", [{ psm: 7 }, { psm: 6 }]),
        readRegionText(buffer, buildStatsRowRegion(block, index), "stats", [
          { psm: 7, whitelist: "0123456789 " },
          { psm: 6, whitelist: "0123456789 " }
        ])
      ]);

      const parsedName = parseNameLines(nameText)[0] ?? normalizePlayerName(nameText);
      const parsedStats = parseStatsRow(statsText);

      return {
        nameText,
        statsText,
        parsedName,
        parsedStats
      };
    })
  );

  const players = rows
    .map((row) => {
      const stats = row.parsedStats;
      return {
        nickname: row.parsedName,
        kills: stats?.kills ?? 0,
        deaths: stats?.deaths ?? 0,
        assists: stats?.assists ?? null,
        headshotPct: stats?.headshotPct ?? 0,
        damage: repairDamage(stats?.damage ?? 0),
        kda: stats ? (stats.deaths === 0 ? stats.kills : Math.round((stats.kills / stats.deaths) * 100) / 100) : 0
      } satisfies ParsedPlayer;
    })
    .filter((player) => player.nickname);

  return {
    players,
    rawNames: rows.map((row) => row.parsedName),
    debug: Object.fromEntries(
      rows.flatMap((row, index) => [
        [`row${index + 1}NameText`, row.nameText],
        [`row${index + 1}StatsText`, row.statsText]
      ])
    )
  };
}

function hasMeaningfulStats(players: ParsedPlayer[]) {
  return players.filter((player) => player.kills > 0 || player.deaths > 0 || player.damage > 0).length;
}

function mergeTeamPlayers(input: {
  roster: readonly string[];
  rowPlayers: ParsedPlayer[];
  rowNames: string[];
  columnPlayers: ParsedPlayer[];
}) {
  const names = normalizeTeamNames(input.rowNames, input.roster);
  const statsSource =
    hasMeaningfulStats(input.columnPlayers) >= hasMeaningfulStats(input.rowPlayers)
      ? input.columnPlayers
      : input.rowPlayers;

  const paddedStats = [...statsSource];
  while (paddedStats.length < 5) {
    paddedStats.push({
      nickname: "",
      kills: 0,
      deaths: 0,
      assists: null,
      headshotPct: 0,
      damage: 0,
      kda: 0
    });
  }

  return names.map((name, index) => {
    const stats = paddedStats[index];
    const damage = repairDamage(stats.damage);
    const kills = stats.kills;
    const deaths = stats.deaths;

    return {
      nickname: name,
      kills,
      deaths,
      assists: stats.assists,
      headshotPct: stats.headshotPct,
      damage,
      kda: deaths === 0 ? kills : Math.round((kills / deaths) * 100) / 100
    } satisfies ParsedPlayer;
  });
}

export async function parseMatchScreenshot(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Не удалось определить размеры изображения");
  }

  const [scoreText, topScoreText, bottomScoreText, mapText, mapTextEng, topTeamRows, bottomTeamRows, topTeamColumns, bottomTeamColumns] = await Promise.all([
    readRegionText(buffer, SCORE_REGION, "score", [
      { psm: 7, whitelist: "0123456789:-" },
      { psm: 6, whitelist: "0123456789:-" }
    ]),
    readRegionText(buffer, TOP_SCORE_REGION, "score", [
      { psm: 10, whitelist: "0123456789" },
      { psm: 7, whitelist: "0123456789" }
    ]),
    readRegionText(buffer, BOTTOM_SCORE_REGION, "score", [
      { psm: 10, whitelist: "0123456789" },
      { psm: 7, whitelist: "0123456789" }
    ]),
    readRegionText(buffer, MAP_REGION, "map", [{ psm: 6 }]),
    readRegionText(buffer, MAP_REGION, "map", [{ psm: 7, lang: "eng" }, { psm: 6, lang: "eng" }]),
    readTeamByRows(buffer, TOP_TEAM),
    readTeamByRows(buffer, BOTTOM_TEAM),
    readTeamBlock(buffer, TOP_TEAM),
    readTeamBlock(buffer, BOTTOM_TEAM)
  ]);

  const topPlayers = mergeTeamPlayers({
    roster: TOP_TEAM_ROSTER,
    rowPlayers: topTeamRows.players,
    rowNames: topTeamRows.rawNames,
    columnPlayers: topTeamColumns.players
  });

  const bottomPlayers = mergeTeamPlayers({
    roster: BOTTOM_TEAM_ROSTER,
    rowPlayers: bottomTeamRows.players,
    rowNames: bottomTeamRows.rawNames,
    columnPlayers: bottomTeamColumns.players
  });

  if (!topPlayers.length || !bottomPlayers.length) {
    throw buildError({
      scoreText,
      topScoreText,
      bottomScoreText,
      mapText,
      mapTextEng,
      topNamesText: topTeamColumns.debug.namesText,
      topKillsText: topTeamColumns.debug.killsText,
      topDeathsText: topTeamColumns.debug.deathsText,
      topAssistsText: topTeamColumns.debug.assistsText,
      topHeadshotText: topTeamColumns.debug.headshotText,
      topDamageText: topTeamColumns.debug.damageText,
      bottomNamesText: bottomTeamColumns.debug.namesText,
      bottomKillsText: bottomTeamColumns.debug.killsText,
      bottomDeathsText: bottomTeamColumns.debug.deathsText,
      bottomAssistsText: bottomTeamColumns.debug.assistsText,
      bottomHeadshotText: bottomTeamColumns.debug.headshotText,
      bottomDamageText: bottomTeamColumns.debug.damageText,
      ...Object.fromEntries(
        Object.entries(topTeamRows.debug).map(([key, value]) => [`top${key}`, value])
      ),
      ...Object.fromEntries(
        Object.entries(bottomTeamRows.debug).map(([key, value]) => [`bottom${key}`, value])
      )
    });
  }

  const { scoreA, scoreB } = parseScoreText(scoreText);
  const sidebarScores = {
    top: parseNumbers(topScoreText, 0, 13)[0] ?? Math.min(scoreA, scoreB),
    bottom: parseNumbers(bottomScoreText, 0, 13)[0] ?? Math.max(scoreA, scoreB)
  };

  const teams: ParsedTeam[] = [
    {
      name: "Спецназ",
      side: "CT",
      score: sidebarScores.top,
      players: topPlayers
    },
    {
      name: "Террористы",
      side: "T",
      score: sidebarScores.bottom,
      players: bottomPlayers
    }
  ];

  const finalScoreA = Math.max(sidebarScores.top, sidebarScores.bottom);
  const finalScoreB = Math.min(sidebarScores.top, sidebarScores.bottom);

  return {
    mapName: parseMapName(`${mapText}\n${mapTextEng}`),
    score: `${finalScoreA}-${finalScoreB}`,
    scoreA: finalScoreA,
    scoreB: finalScoreB,
    teams
  };
}
