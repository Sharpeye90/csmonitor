import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OcrRegionManifest = {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
  mode: "names" | "stats" | "score" | "map";
  lang?: "ru" | "en";
};

export type OcrRegionResult = {
  name: string;
  text: string;
  image: string;
  processedImage: string;
};

export async function readRegionsWithPaddleOCR(regions: OcrRegionManifest[], imageBuffer: Buffer) {
  const root = process.cwd();
  const workDir = join(root, ".paddlex");
  await mkdir(workDir, { recursive: true });

  const imagePath = join(tmpdir(), `${randomUUID()}.png`);
  const manifestPath = join(tmpdir(), `${randomUUID()}.json`);
  const pythonBin = join(root, ".venv", "bin", "python");
  const scriptPath = join(root, "scripts", "paddle_ocr_regions.py");

  await writeFile(imagePath, imageBuffer);
  await writeFile(manifestPath, JSON.stringify({ regions }, null, 2));

  try {
    const { stdout, stderr } = await execFileAsync(
      pythonBin,
      [scriptPath, imagePath, manifestPath],
      {
        cwd: root,
        env: {
          ...process.env,
          HOME: root,
          PADDLEX_HOME: workDir,
          PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True"
        },
        maxBuffer: 20 * 1024 * 1024
      }
    );

    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    const parsed = JSON.parse(stdout) as { error?: string; regions?: OcrRegionResult[] };
    if (parsed.error) {
      throw new Error(parsed.error);
    }

    return parsed.regions ?? [];
  } finally {
    await Promise.all([
      unlink(imagePath).catch(() => undefined),
      unlink(manifestPath).catch(() => undefined)
    ]);
  }
}
