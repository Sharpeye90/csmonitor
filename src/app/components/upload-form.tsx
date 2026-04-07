"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { SavedMatch, SeasonSummary } from "@/lib/types";

type UploadState = {
  error: string | null;
  details?: Record<string, string> | null;
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
        details?: Record<string, string> | null;
      };
      error.details = payload.details ?? null;
      throw error;
    }

    setState(payload);
    router.refresh();
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
                    ? ((error as { details?: Record<string, string> | null }).details ?? null)
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
        <button type="submit" disabled={isPending}>
          {isPending ? "Обрабатываем..." : "Распознать и сохранить"}
        </button>
      </form>

      {state.error ? <p className="error">{state.error}</p> : null}
      {state.details ? (
        <details style={{ marginTop: 12 }}>
          <summary className="muted">Показать OCR-диагностику</summary>
          <pre
            style={{
              marginTop: 12,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              fontSize: 12,
              lineHeight: 1.5
            }}
          >
            {JSON.stringify(state.details, null, 2)}
          </pre>
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
                        <td>{player.kda}</td>
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
