"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { SavedMatch, SeasonSummary } from "@/lib/types";

type UploadDetails = {
  parsedPreview?: string;
  engineDebug?: unknown;
  ocrTexts?: Record<string, string>;
  zones?: Array<{ name: string; image: string; processedImage: string; text: string; debug?: unknown }>;
};

type UploadState = {
  error: string | null;
  details?: UploadDetails | null;
  testMode?: boolean;
  match: SavedMatch | null;
};

export function UploadForm({ seasons }: { seasons: SeasonSummary[] }) {
  const router = useRouter();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [state, setState] = useState<UploadState>({ error: null, match: null });
  const [isPending, startTransition] = useTransition();
  const parsedMatch = state.match;

  async function handleSubmit(formData: FormData) {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const payload = (await response.json()) as UploadState;

    if (!response.ok) {
      const error = new Error(payload.error || "Не удалось обработать скриншот") as Error & {
        details?: UploadDetails | null;
      };
      error.details = payload.details ?? null;
      throw error;
    }

    setState(payload);
    if (!payload.testMode) {
      router.refresh();
    }
  }

  return (
    <div className="panel">
      <h2 className="section-title">Загрузка скриншота</h2>
      <form
        className="upload-form"
        action={(formData) =>
          startTransition(async () => {
            try {
              setState({ error: null, match: null });
              await handleSubmit(formData);
            } catch (error) {
              setState({
                error: error instanceof Error ? error.message : "Неизвестная ошибка",
                details:
                  error && typeof error === "object" && "details" in error
                    ? ((error as { details?: UploadDetails | null }).details ?? null)
                    : null,
                match: null
              });
            }
          })
        }
      >
        <label>
          Скриншот результата матча
          <input
            required
            name="screenshot"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];

              if (!file) {
                setPreviewUrl(null);
                return;
              }

              setPreviewUrl(URL.createObjectURL(file));
            }}
          />
        </label>
        <label>
          Сезон
          <select name="seasonId" defaultValue="">
            <option value="">Определить автоматически по дате матча</option>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-row">
          <input name="testMode" type="checkbox" />
          Тестовый режим без сохранения
        </label>
        <button type="submit" disabled={isPending}>
          {isPending ? "Обрабатываем..." : "Запустить"}
        </button>
      </form>

      {state.error ? <p className="error">{state.error}</p> : null}
      {state.details ? (
        <details style={{ marginTop: 12 }}>
          <summary className="muted">
            {state.testMode ? "Показать диагностику тестового режима" : "Показать OCR-диагностику"}
          </summary>
          <pre
            style={{
              marginTop: 12,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontSize: 12,
              lineHeight: 1.5
            }}
          >
            {JSON.stringify(
              {
                parsedPreview: state.details.parsedPreview,
                engineDebug: state.details.engineDebug,
                ocrTexts: state.details.ocrTexts
              },
              null,
              2
            )}
          </pre>
          {state.details.zones?.length ? (
            <div className="zones-grid">
              {state.details.zones.map((zone) => (
                <div key={zone.name} className="zone-card">
                  <strong>{zone.name}</strong>
                  <img src={zone.image} alt={zone.name} />
                  <img src={zone.processedImage} alt={`${zone.name} processed`} />
                  <pre>{zone.text || "(empty)"}</pre>
                  <pre>{JSON.stringify(zone.debug ?? null, null, 2)}</pre>
                </div>
              ))}
            </div>
          ) : null}
        </details>
      ) : null}

      {parsedMatch ? (
        <div className="match-card" style={{ marginTop: 18 }}>
          <header>
            <div>
              <h3>{parsedMatch.mapName}</h3>
              <p className="muted" style={{ marginBottom: 0 }}>
                Дата матча: {parsedMatch.playedOn}
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                Сезон: {parsedMatch.season?.name ?? "не назначен"}
              </p>
              {state.testMode ? (
                <p className="muted" style={{ marginBottom: 0 }}>
                  Режим: тестовый, без сохранения
                </p>
              ) : null}
            </div>
            <span className="score-chip">
              {parsedMatch.scoreA}-{parsedMatch.scoreB}
            </span>
          </header>

          <div className="teams-grid">
            {parsedMatch.teams.map((team) => (
              <div key={`${parsedMatch.id}-${team.side}-${team.name}`} className="team-card">
                <header>
                  <h4>
                    {team.name} • {team.side}
                  </h4>
                  <span>{team.score}</span>
                </header>

                <table className="players-table">
                  <thead>
                    <tr>
                      <th>Игрок</th>
                      <th>У</th>
                      <th>С</th>
                      <th>KDA</th>
                      <th>Урон</th>
                      <th>%ГЛ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.players.map((player) => (
                      <tr key={`${team.name}-${player.nickname}`}>
                        <td>{player.nickname}</td>
                        <td>{player.kills}</td>
                        <td>{player.deaths}</td>
                        <td>{player.kda.toFixed(2)}</td>
                        <td>{player.damage}</td>
                        <td>{player.headshotPct}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {previewUrl ? (
        <div className="preview-box" style={{ marginTop: 18 }}>
          <img src={previewUrl} alt="Предпросмотр загруженного скриншота" />
        </div>
      ) : null}
    </div>
  );
}
