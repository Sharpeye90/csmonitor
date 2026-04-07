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

async function preprocessRegion(input: Buffer, region: Region, mode: PreprocessMode, variant: "enhanced" | "soft" | "raw" = "enhanced") {
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
      pipeline = pipeline.linear(1.15, -8);
    } else {
      pipeline = pipeline.linear(1.2, -10);
    }
  } else if (variant === "soft") {
    if (mode === "stats" || mode === "score") {
      pipeline = pipeline.linear(1.15, -6);
    } else {
      pipeline = pipeline.linear(1.08, -2);
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
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Локальный OCR не сработал: ${error.message}`);
    }

    throw error;
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
  const texts = await Promise.all(
    buffers.flatMap((buffer) => runs.map((item) => tryOcr(buffer, item)))
  );

  return pickBestOcrResult(texts);
}

function cleanupName(line: string) {
  return line
    .replace(/^[\d\s]+/, "")
    .replace(/^[^\p{L}\p{N}\[]+/u, "")
    .replace(/[^\p{L}\p{N}\]_ |\-.]+$/gu, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isProbablyName(line: string) {
  const cleaned = cleanupName(line);

  if (cleaned.length < 2) {
    return false;
  }

  if (/убийства|смерти|помощи|урон|террористы|спецназ|победа/i.test(cleaned)) {
    return false;
  }

  return /[\p{L}]/u.test(cleaned);
}

function parseNameLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(isProbablyName)
    .map(cleanupName);
}

function parseStatLine(line: string): Omit<ParsedPlayer, "nickname" | "kda"> | null {
  const numbers = Array.from(line.matchAll(/\d{1,5}/g)).map((item) => Number(item[0]));

  if (numbers.length < 4) {
    return null;
  }

  const tail = numbers.slice(-5);

  if (tail.length === 5) {
    const [kills, deaths, assists, headshotPct, damage] = tail;

    if (damage < 100 || kills > 60 || deaths > 60 || headshotPct > 100) {
      return null;
    }

    return {
      kills,
      deaths,
      assists,
      headshotPct,
      damage
    };
  }

  const [kills, deaths, headshotPct, damage] = tail;

  if (damage < 100 || kills > 60 || deaths > 60 || headshotPct > 100) {
    return null;
  }

  return {
    kills,
    deaths,
    assists: null,
    headshotPct,
    damage
  };
}

function parseStatsLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .map(parseStatLine)
    .filter((item): item is NonNullable<ReturnType<typeof parseStatLine>> => item !== null);
}

function pairPlayers(names: string[], stats: ReturnType<typeof parseStatsLines>) {
  const count = Math.min(names.length, stats.length);

  return Array.from({ length: count }, (_, index) => {
    const stat = stats[index];

    return {
      nickname: names[index],
      kills: stat.kills,
      deaths: stat.deaths,
      assists: stat.assists,
      headshotPct: stat.headshotPct,
      damage: stat.damage,
      kda: `${stat.kills}/${stat.deaths}`
    } satisfies ParsedPlayer;
  });
}

function parseScoreText(text: string) {
  const match = text.match(/(\d{1,2})\s*[-:]\s*(\d{1,2})/);

  if (match) {
    return {
      scoreA: Number(match[1]),
      scoreB: Number(match[2])
    };
  }

  const loose = Array.from(text.matchAll(/\d{1,2}/g)).map((item) => Number(item[0]));
  if (loose.length >= 2) {
    return {
      scoreA: loose[0],
      scoreB: loose[1]
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

  return "Unknown";
}

function buildError(details: Record<string, string>) {
  const error = new Error("Не удалось распознать строки игроков. Проверьте качество скриншота.");
  (error as Error & { details?: Record<string, string> }).details = details;
  return error;
}

export async function parseMatchScreenshot(buffer: Buffer) {
  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error("Не удалось определить размеры изображения");
  }

  const scoreText = await readRegionText(
    buffer,
    { left: 0.39, top: 0.03, width: 0.22, height: 0.08 },
    "score",
    [
      { psm: 7, whitelist: "0123456789:-" },
      { psm: 6, whitelist: "0123456789:-" }
    ]
  );

  const mapText = await readRegionText(
    buffer,
    { left: 0.16, top: 0.33, width: 0.32, height: 0.08 },
    "map",
    [{ psm: 6 }]
  );

  const topNamesText = await readRegionText(
    buffer,
    { left: 0.23, top: 0.43, width: 0.34, height: 0.19 },
    "names",
    [{ psm: 6 }, { psm: 11 }]
  );

  const topStatsText = await readRegionText(
    buffer,
    { left: 0.60, top: 0.43, width: 0.22, height: 0.19 },
    "stats",
    [
      { psm: 6, whitelist: "0123456789 " },
      { psm: 11, whitelist: "0123456789 " }
    ]
  );

  const bottomNamesText = await readRegionText(
    buffer,
    { left: 0.23, top: 0.70, width: 0.34, height: 0.18 },
    "names",
    [{ psm: 6 }, { psm: 11 }]
  );

  const bottomStatsText = await readRegionText(
    buffer,
    { left: 0.60, top: 0.70, width: 0.22, height: 0.18 },
    "stats",
    [
      { psm: 6, whitelist: "0123456789 " },
      { psm: 11, whitelist: "0123456789 " }
    ]
  );

  const topNames = parseNameLines(topNamesText);
  const bottomNames = parseNameLines(bottomNamesText);
  const topStats = parseStatsLines(topStatsText);
  const bottomStats = parseStatsLines(bottomStatsText);

  if (!scoreText || !mapText || !topNames.length || !bottomNames.length || !topStats.length || !bottomStats.length) {
    throw buildError({
      scoreText,
      mapText,
      topNamesText,
      topStatsText,
      bottomNamesText,
      bottomStatsText
    });
  }

  const topPlayers = pairPlayers(topNames, topStats);
  const bottomPlayers = pairPlayers(bottomNames, bottomStats);

  if (!topPlayers.length || !bottomPlayers.length) {
    throw buildError({
      scoreText,
      mapText,
      topNamesText,
      topStatsText,
      bottomNamesText,
      bottomStatsText
    });
  }

  const { scoreA, scoreB } = parseScoreText(scoreText);

  const teams: ParsedTeam[] = [
    {
      name: "Спецназ",
      side: "CT",
      score: scoreA,
      players: topPlayers
    },
    {
      name: "Террористы",
      side: "T",
      score: scoreB,
      players: bottomPlayers
    }
  ];

  return {
    mapName: parseMapName(mapText),
    score: `${scoreA}-${scoreB}`,
    scoreA,
    scoreB,
    teams
  };
}
