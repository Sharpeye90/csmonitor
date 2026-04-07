"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { SavedMatch, SeasonSummary } from "@/lib/types";

type UploadState = {
  error: string | null;
  match: SavedMatch | null;
};

export function UploadForm({ seasons }: { seasons: SeasonSummary[] }) {
  const router = useRouter();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [state, setState] = useState<UploadState>({ error: null, match: null });
  const [editableMatch, setEditableMatch] = useState<SavedMatch | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const parsedMatch = editableMatch ?? state.match;

  function cloneMatch(match: SavedMatch) {
    return {
      ...match,
      season: match.season ? { ...match.season } : null,
      teams: match.teams.map((team) => ({
        ...team,
        players: team.players.map((player) => ({ ...player }))
      }))
    };
  }

  function recalculateMatch(match: SavedMatch) {
    return {
      ...match,
      teams: match.teams.map((team) => ({
        ...team,
        players: team.players.map((player) => {
          const kills = Number(player.kills) || 0;
          const deaths = Number(player.deaths) || 0;
          return {
            ...player,
            kills,
            deaths,
            assists: player.assists == null ? null : Number(player.assists) || 0,
            damage: Number(player.damage) || 0,
            headshotPct: Number(player.headshotPct) || 0,
            kda: deaths === 0 ? kills : Math.round((kills / deaths) * 100) / 100
          };
        })
      }))
    };
  }

  async function saveEditedMatch() {
    if (!editableMatch) {
      return;
    }

    const normalized = recalculateMatch(editableMatch);
    const response = await fetch("/api/matches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: normalized.id,
        uploadedAtIso: normalized.uploadedAtIso ?? normalized.uploadedAt,
        playedOnIso: normalized.playedOnIso,
        mapName: normalized.mapName,
        scoreA: normalized.scoreA,
        scoreB: normalized.scoreB,
        seasonId: normalized.season?.id ?? null,
        teams: normalized.teams
      })
    });

    const payload = (await response.json()) as UploadState;
    if (!response.ok || !payload.match) {
      throw new Error(payload.error || "Не удалось сохранить исправления");
    }

    setState((current) => ({
      ...current,
      error: null,
      match: payload.match
    }));
    setEditableMatch(payload.match);
    setIsEditing(false);
    router.refresh();
  }

  async function handleSubmit(formData: FormData) {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const payload = (await response.json()) as UploadState;

    if (!response.ok) {
      throw new Error(payload.error || "Не удалось обработать скриншот");
    }

    setState(payload);
    setEditableMatch(payload.match ? cloneMatch(payload.match) : null);
    setIsEditing(false);
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
              setEditableMatch(null);
              setIsEditing(false);
              await handleSubmit(formData);
            } catch (error) {
              setState({
                error: error instanceof Error ? error.message : "Неизвестная ошибка",
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
          {isPending ? "Обрабатываем..." : "Запустить"}
        </button>
      </form>

      {state.error ? <p className="error">{state.error}</p> : null}

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

          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setEditableMatch(cloneMatch(parsedMatch));
                setIsEditing((current) => !current);
              }}
            >
              {isEditing ? "Скрыть редактирование" : "Редактировать результат"}
            </button>
            {isEditing ? (
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await saveEditedMatch();
                    } catch (error) {
                      setState((current) => ({
                        ...current,
                        error: error instanceof Error ? error.message : "Не удалось сохранить исправления"
                      }));
                    }
                  })
                }
                disabled={isPending}
              >
                Сохранить исправления
              </button>
            ) : null}
          </div>

          {isEditing && editableMatch ? (
            <div className="edit-grid" style={{ marginTop: 16 }}>
              <label>
                Карта
                <input
                  type="text"
                  value={editableMatch.mapName}
                  onChange={(event) =>
                    setEditableMatch((current) =>
                      current ? { ...current, mapName: event.target.value } : current
                    )
                  }
                />
              </label>
              <label>
                Счет A
                <input
                  type="number"
                  value={editableMatch.scoreA}
                  onChange={(event) =>
                    setEditableMatch((current) =>
                      current ? { ...current, scoreA: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>
              <label>
                Счет B
                <input
                  type="number"
                  value={editableMatch.scoreB}
                  onChange={(event) =>
                    setEditableMatch((current) =>
                      current ? { ...current, scoreB: Number(event.target.value) || 0 } : current
                    )
                  }
                />
              </label>
              <label>
                Сезон
                <select
                  value={editableMatch.season?.id ?? ""}
                  onChange={(event) =>
                    setEditableMatch((current) =>
                      current
                        ? {
                            ...current,
                            season:
                              seasons.find((season) => season.id === event.target.value) ?? null
                          }
                        : current
                    )
                  }
                >
                  <option value="">Без сезона</option>
                  {seasons.map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <div className="teams-grid">
            {parsedMatch.teams.map((team, teamIndex) => (
              <div key={`${parsedMatch.id}-${team.side}-${team.name}`} className="team-card">
                <header>
                  <h4>
                    {team.name} • {team.side}
                  </h4>
                  <span>{team.score}</span>
                </header>

                {isEditing && editableMatch ? (
                  <div className="edit-grid" style={{ marginTop: 12 }}>
                    <label>
                      Название команды
                      <input
                        type="text"
                        value={editableMatch.teams[teamIndex]?.name ?? ""}
                        onChange={(event) =>
                          setEditableMatch((current) => {
                            if (!current) {
                              return current;
                            }
                            const teams = current.teams.map((item, index) =>
                              index === teamIndex ? { ...item, name: event.target.value } : item
                            );
                            return { ...current, teams };
                          })
                        }
                      />
                    </label>
                    <label>
                      Сторона
                      <input
                        type="text"
                        value={editableMatch.teams[teamIndex]?.side ?? ""}
                        onChange={(event) =>
                          setEditableMatch((current) => {
                            if (!current) {
                              return current;
                            }
                            const teams = current.teams.map((item, index) =>
                              index === teamIndex ? { ...item, side: event.target.value } : item
                            );
                            return { ...current, teams };
                          })
                        }
                      />
                    </label>
                    <label>
                      Счет команды
                      <input
                        type="number"
                        value={editableMatch.teams[teamIndex]?.score ?? 0}
                        onChange={(event) =>
                          setEditableMatch((current) => {
                            if (!current) {
                              return current;
                            }
                            const teams = current.teams.map((item, index) =>
                              index === teamIndex
                                ? { ...item, score: Number(event.target.value) || 0 }
                                : item
                            );
                            return { ...current, teams };
                          })
                        }
                      />
                    </label>
                  </div>
                ) : null}

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
                    {team.players.map((player, playerIndex) => (
                      <tr key={`${team.name}-${player.nickname}`}>
                        <td>
                          {isEditing && editableMatch ? (
                            <input
                              type="text"
                              value={editableMatch.teams[teamIndex]?.players[playerIndex]?.nickname ?? ""}
                              onChange={(event) =>
                                setEditableMatch((current) => {
                                  if (!current) {
                                    return current;
                                  }
                                  const teams = current.teams.map((teamItem, currentTeamIndex) => {
                                    if (currentTeamIndex !== teamIndex) {
                                      return teamItem;
                                    }

                                    return {
                                      ...teamItem,
                                      players: teamItem.players.map((playerItem, currentPlayerIndex) =>
                                        currentPlayerIndex === playerIndex
                                          ? { ...playerItem, nickname: event.target.value }
                                          : playerItem
                                      )
                                    };
                                  });
                                  return { ...current, teams };
                                })
                              }
                            />
                          ) : (
                            player.nickname
                          )}
                        </td>
                        <td>
                          {isEditing && editableMatch ? (
                            <input
                              type="number"
                              value={editableMatch.teams[teamIndex]?.players[playerIndex]?.kills ?? 0}
                              onChange={(event) =>
                                setEditableMatch((current) => {
                                  if (!current) {
                                    return current;
                                  }
                                  const teams = current.teams.map((teamItem, currentTeamIndex) => {
                                    if (currentTeamIndex !== teamIndex) {
                                      return teamItem;
                                    }

                                    return {
                                      ...teamItem,
                                      players: teamItem.players.map((playerItem, currentPlayerIndex) =>
                                        currentPlayerIndex === playerIndex
                                          ? { ...playerItem, kills: Number(event.target.value) || 0 }
                                          : playerItem
                                      )
                                    };
                                  });
                                  return recalculateMatch({ ...current, teams });
                                })
                              }
                            />
                          ) : (
                            player.kills
                          )}
                        </td>
                        <td>
                          {isEditing && editableMatch ? (
                            <input
                              type="number"
                              value={editableMatch.teams[teamIndex]?.players[playerIndex]?.deaths ?? 0}
                              onChange={(event) =>
                                setEditableMatch((current) => {
                                  if (!current) {
                                    return current;
                                  }
                                  const teams = current.teams.map((teamItem, currentTeamIndex) => {
                                    if (currentTeamIndex !== teamIndex) {
                                      return teamItem;
                                    }

                                    return {
                                      ...teamItem,
                                      players: teamItem.players.map((playerItem, currentPlayerIndex) =>
                                        currentPlayerIndex === playerIndex
                                          ? { ...playerItem, deaths: Number(event.target.value) || 0 }
                                          : playerItem
                                      )
                                    };
                                  });
                                  return recalculateMatch({ ...current, teams });
                                })
                              }
                            />
                          ) : (
                            player.deaths
                          )}
                        </td>
                        <td>{player.kda.toFixed(2)}</td>
                        <td>
                          {isEditing && editableMatch ? (
                            <input
                              type="number"
                              value={editableMatch.teams[teamIndex]?.players[playerIndex]?.damage ?? 0}
                              onChange={(event) =>
                                setEditableMatch((current) => {
                                  if (!current) {
                                    return current;
                                  }
                                  const teams = current.teams.map((teamItem, currentTeamIndex) => {
                                    if (currentTeamIndex !== teamIndex) {
                                      return teamItem;
                                    }

                                    return {
                                      ...teamItem,
                                      players: teamItem.players.map((playerItem, currentPlayerIndex) =>
                                        currentPlayerIndex === playerIndex
                                          ? { ...playerItem, damage: Number(event.target.value) || 0 }
                                          : playerItem
                                      )
                                    };
                                  });
                                  return recalculateMatch({ ...current, teams });
                                })
                              }
                            />
                          ) : (
                            player.damage
                          )}
                        </td>
                        <td>
                          {isEditing && editableMatch ? (
                            <input
                              type="number"
                              value={editableMatch.teams[teamIndex]?.players[playerIndex]?.headshotPct ?? 0}
                              onChange={(event) =>
                                setEditableMatch((current) => {
                                  if (!current) {
                                    return current;
                                  }
                                  const teams = current.teams.map((teamItem, currentTeamIndex) => {
                                    if (currentTeamIndex !== teamIndex) {
                                      return teamItem;
                                    }

                                    return {
                                      ...teamItem,
                                      players: teamItem.players.map((playerItem, currentPlayerIndex) =>
                                        currentPlayerIndex === playerIndex
                                          ? { ...playerItem, headshotPct: Number(event.target.value) || 0 }
                                          : playerItem
                                      )
                                    };
                                  });
                                  return recalculateMatch({ ...current, teams });
                                })
                              }
                            />
                          ) : (
                            player.headshotPct
                          )}
                        </td>
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
