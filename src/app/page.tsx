import { prisma } from "@/lib/db";
import { formatRuDate } from "@/lib/date";
import { ResetDatabaseButton } from "@/app/components/reset-database-button";
import { SeasonForm } from "@/app/components/season-form";
import { UploadForm } from "@/app/components/upload-form";

const timeZone = process.env.APP_TIMEZONE || "Europe/Moscow";
export const dynamic = "force-dynamic";

async function getMatches() {
  try {
    return await prisma.match.findMany({
      orderBy: {
        uploadedAt: "desc"
      },
      take: 3,
      include: {
        season: true,
        teams: {
          orderBy: {
            createdAt: "asc"
          },
          include: {
            players: {
              orderBy: {
                kills: "desc"
              }
            }
          }
        }
      }
    });
  } catch {
    return [];
  }
}

async function getSeasons() {
  try {
    return await prisma.season.findMany({
      orderBy: {
        startDate: "desc"
      }
    });
  } catch {
    return [];
  }
}

async function getPlayerSeasonStats() {
  try {
    const matches = await prisma.match.findMany({
      orderBy: {
        playedOn: "desc"
      },
      include: {
        season: true,
        teams: {
          include: {
            players: true
          }
        }
      }
    });

    const grouped = new Map<
      string,
      {
        seasonName: string;
        nickname: string;
        matches: number;
        kills: number;
        deaths: number;
        damage: number;
        headshotPctTotal: number;
      }
    >();

    for (const match of matches) {
      const seasonName = match.season?.name ?? "Без сезона";

      for (const team of match.teams) {
        for (const player of team.players) {
          const key = `${seasonName}::${player.nickname}`;
          const existing = grouped.get(key) ?? {
            seasonName,
            nickname: player.nickname,
            matches: 0,
            kills: 0,
            deaths: 0,
            damage: 0,
            headshotPctTotal: 0
          };

          existing.matches += 1;
          existing.kills += player.kills;
          existing.deaths += player.deaths;
          existing.damage += player.damage;
          existing.headshotPctTotal += player.headshotPct;
          grouped.set(key, existing);
        }
      }
    }

    return Array.from(grouped.values())
      .map((item) => ({
        ...item,
        avgKdaPerMatch:
          item.matches === 0 ? 0 : Math.round(((item.deaths === 0 ? item.kills : item.kills / item.deaths) / item.matches) * 100) / 100,
        avgDamagePerMatch: item.matches === 0 ? 0 : Math.round(item.damage / item.matches),
        avgHeadshotPct: Math.round((item.headshotPctTotal / item.matches) * 10) / 10
      }))
      .sort((left, right) => {
        if (left.seasonName !== right.seasonName) {
          return left.seasonName.localeCompare(right.seasonName, "ru");
        }

        return right.avgDamagePerMatch - left.avgDamagePerMatch;
      });
  } catch {
    return [];
  }
}

async function getPlayerMapStats() {
  try {
    const matches = await prisma.match.findMany({
      orderBy: {
        playedOn: "desc"
      },
      include: {
        teams: {
          include: {
            players: true
          }
        }
      }
    });

    const grouped = new Map<
      string,
      {
        mapName: string;
        nickname: string;
        matches: number;
        kills: number;
        deaths: number;
        damage: number;
        headshotPctTotal: number;
      }
    >();

    for (const match of matches) {
      for (const team of match.teams) {
        for (const player of team.players) {
          const key = `${match.mapName}::${player.nickname}`;
          const existing = grouped.get(key) ?? {
            mapName: match.mapName,
            nickname: player.nickname,
            matches: 0,
            kills: 0,
            deaths: 0,
            damage: 0,
            headshotPctTotal: 0
          };

          existing.matches += 1;
          existing.kills += player.kills;
          existing.deaths += player.deaths;
          existing.damage += player.damage;
          existing.headshotPctTotal += player.headshotPct;
          grouped.set(key, existing);
        }
      }
    }

    const mapOrder = ["Dust II", "Mirage", "Inferno", "Nuke", "Ancient", "Anubis", "Overpass"];

    return Array.from(grouped.values())
      .map((item) => ({
        ...item,
        avgKda:
          item.matches === 0 ? 0 : Math.round(((item.deaths === 0 ? item.kills : item.kills / item.deaths) / item.matches) * 100) / 100,
        avgDamage: item.matches === 0 ? 0 : Math.round(item.damage / item.matches),
        avgHeadshotPct: Math.round((item.headshotPctTotal / item.matches) * 10) / 10
      }))
      .sort((left, right) => {
        const leftIndex = mapOrder.indexOf(left.mapName);
        const rightIndex = mapOrder.indexOf(right.mapName);

        if (leftIndex !== rightIndex) {
          return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex);
        }

        return right.avgDamage - left.avgDamage;
      });
  } catch {
    return [];
  }
}

function getPlayedOnDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function rankValuesDescending<T>(rows: T[], pickValue: (row: T) => number) {
  const sortedValues = Array.from(new Set(rows.map(pickValue))).sort((left, right) => right - left);
  return new Map(sortedValues.map((value, index) => [value, index + 1]));
}

type TrendDirection = "up" | "down" | "flat";

async function getDailyPlayerRatings() {
  try {
    const matches = await prisma.match.findMany({
      orderBy: {
        playedOn: "desc"
      },
      include: {
        season: true,
        teams: {
          include: {
            players: true
          }
        }
      }
    });

    const grouped = new Map<
      string,
      {
        playedOn: Date;
        playedOnKey: string;
        seasonName: string;
        nickname: string;
        matches: number;
        kdaTotal: number;
        damageTotal: number;
      }
    >();

    for (const match of matches) {
      const playedOnKey = getPlayedOnDayKey(match.playedOn);
      const seasonName = match.season?.name ?? "Без сезона";

      for (const team of match.teams) {
        for (const player of team.players) {
          const key = `${playedOnKey}::${player.nickname}`;
          const existing = grouped.get(key) ?? {
            playedOn: match.playedOn,
            playedOnKey,
            seasonName,
            nickname: player.nickname,
            matches: 0,
            kdaTotal: 0,
            damageTotal: 0
          };

          existing.matches += 1;
          existing.kdaTotal += player.kda;
          existing.damageTotal += player.damage;
          grouped.set(key, existing);
        }
      }
    }

    const byDay = new Map<string, Array<(typeof grouped extends Map<string, infer V> ? V : never)>>();
    for (const row of grouped.values()) {
      const rows = byDay.get(row.playedOnKey) ?? [];
      rows.push(row);
      byDay.set(row.playedOnKey, rows);
    }

    const rankedRows: Array<{
      playedOn: Date;
      playedOnKey: string;
      seasonName: string;
      nickname: string;
      matches: number;
      avgKda: number;
      avgDamage: number;
      kdaRank: number;
      damageRank: number;
      points: number;
    }> = [];

    for (const rows of byDay.values()) {
      const enriched = rows.map((row) => ({
        ...row,
        avgKda: Math.round((row.kdaTotal / row.matches) * 100) / 100,
        avgDamage: Math.round(row.damageTotal / row.matches)
      }));
      const kdaRanks = rankValuesDescending(enriched, (row) => row.avgKda);
      const damageRanks = rankValuesDescending(enriched, (row) => row.avgDamage);

      for (const row of enriched) {
        const kdaRank = kdaRanks.get(row.avgKda) ?? enriched.length;
        const damageRank = damageRanks.get(row.avgDamage) ?? enriched.length;

        rankedRows.push({
          playedOn: row.playedOn,
          playedOnKey: row.playedOnKey,
          seasonName: row.seasonName,
          nickname: row.nickname,
          matches: row.matches,
          avgKda: row.avgKda,
          avgDamage: row.avgDamage,
          kdaRank,
          damageRank,
          points: (kdaRank + damageRank) * 10
        });
      }
    }

    return rankedRows.sort((left, right) => {
      if (left.playedOnKey !== right.playedOnKey) {
        return left.playedOnKey < right.playedOnKey ? 1 : -1;
      }

      return left.points - right.points;
    });
  } catch {
    return [];
  }
}

async function getSeasonPlayerRatings() {
  try {
    const dailyRatings = await getDailyPlayerRatings();
    const grouped = new Map<
      string,
      {
        seasonName: string;
        nickname: string;
        days: number;
        totalPoints: number;
        avgKdaTotal: number;
        avgDamageTotal: number;
        recentPoints: Array<{ playedOnKey: string; points: number }>;
      }
    >();

    for (const row of dailyRatings) {
      const key = `${row.seasonName}::${row.nickname}`;
      const existing = grouped.get(key) ?? {
        seasonName: row.seasonName,
        nickname: row.nickname,
        days: 0,
        totalPoints: 0,
        avgKdaTotal: 0,
        avgDamageTotal: 0,
        recentPoints: []
      };

      existing.days += 1;
      existing.totalPoints += row.points;
      existing.avgKdaTotal += row.avgKda;
      existing.avgDamageTotal += row.avgDamage;
      existing.recentPoints.push({ playedOnKey: row.playedOnKey, points: row.points });
      grouped.set(key, existing);
    }

    return Array.from(grouped.values())
      .map((row) => {
        const recentPoints = row.recentPoints
          .sort((left, right) => left.playedOnKey.localeCompare(right.playedOnKey))
          .slice(-2);
        const previousPoints = recentPoints.length >= 2 ? recentPoints[recentPoints.length - 2].points : null;
        const latestPoints = recentPoints.length >= 1 ? recentPoints[recentPoints.length - 1].points : null;
        const trend: TrendDirection =
          previousPoints == null || latestPoints == null
            ? "flat"
            : latestPoints < previousPoints
              ? "up"
              : latestPoints > previousPoints
                ? "down"
                : "flat";

        return {
          seasonName: row.seasonName,
          nickname: row.nickname,
          days: row.days,
          totalPoints: row.totalPoints,
          avgPointsPerDay: Math.round((row.totalPoints / row.days) * 10) / 10,
          avgKda: Math.round((row.avgKdaTotal / row.days) * 100) / 100,
          avgDamage: Math.round(row.avgDamageTotal / row.days),
          trend,
          previousPoints,
          latestPoints
        };
      })
      .sort((left, right) => {
        if (left.seasonName !== right.seasonName) {
          return left.seasonName.localeCompare(right.seasonName, "ru");
        }

        return left.totalPoints - right.totalPoints;
      });
  } catch {
    return [];
  }
}

function renderTrend(trend: TrendDirection) {
  if (trend === "up") {
    return <span className="trend trend-up">↑</span>;
  }

  if (trend === "down") {
    return <span className="trend trend-down">↓</span>;
  }

  return <span className="trend trend-flat">→</span>;
}

export default async function HomePage() {
  const [matches, seasons, playerSeasonStats, playerMapStats, dailyPlayerRatings, seasonPlayerRatings] = await Promise.all([
    getMatches(),
    getSeasons(),
    getPlayerSeasonStats(),
    getPlayerMapStats(),
    getDailyPlayerRatings(),
    getSeasonPlayerRatings()
  ]);

  return (
    <main className="page-shell">
      <section className="controls-grid">
        <UploadForm
          seasons={seasons.map((season) => ({
            id: season.id,
            name: season.name,
            startDate: season.startDate.toISOString(),
            endDate: season.endDate.toISOString()
          }))}
        />
        <div className="stacked-panels">
          <SeasonForm />
          <ResetDatabaseButton />
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <h2 className="section-title">Игроки по сезонам</h2>
          {playerSeasonStats.length ? (
            <div className="table-scroll">
              <table className="players-table">
                <thead>
                  <tr>
                    <th>Сезон</th>
                    <th>Игрок</th>
                    <th>Матчи</th>
                    <th>KDA ср.</th>
                    <th>Урон ср.</th>
                    <th>%ГЛ ср.</th>
                  </tr>
                </thead>
                <tbody>
                  {playerSeasonStats.map((row) => (
                    <tr key={`${row.seasonName}-${row.nickname}`}>
                      <td>{row.seasonName}</td>
                      <td>{row.nickname}</td>
                      <td>{row.matches}</td>
                      <td>{row.avgKdaPerMatch.toFixed(2)}</td>
                      <td>{row.avgDamagePerMatch}</td>
                      <td>{row.avgHeadshotPct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Пока нет данных по игрокам.</p>
          )}
        </div>

        <div className="panel">
          <h2 className="section-title">Игроки по картам</h2>
          {playerMapStats.length ? (
            <div className="table-scroll">
              <table className="players-table">
                <thead>
                  <tr>
                    <th>Карта</th>
                    <th>Игрок</th>
                    <th>Матчи</th>
                    <th>KDA ср.</th>
                    <th>Урон ср.</th>
                    <th>%ГЛ ср.</th>
                  </tr>
                </thead>
                <tbody>
                  {playerMapStats.map((row) => (
                    <tr key={`${row.mapName}-${row.nickname}`}>
                      <td>{row.mapName}</td>
                      <td>{row.nickname}</td>
                      <td>{row.matches}</td>
                      <td>{row.avgKda.toFixed(2)}</td>
                      <td>{row.avgDamage}</td>
                      <td>{row.avgHeadshotPct}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Пока нет данных по картам.</p>
          )}
        </div>
      </section>

      <section className="content-grid single-column">
        <div className="panel">
          <h2 className="section-title">Рейтинг За День</h2>
          {dailyPlayerRatings.length ? (
            <div className="table-scroll">
              <table className="players-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Сезон</th>
                    <th>Игрок</th>
                    <th>Матчи</th>
                    <th>KDA ср.</th>
                    <th>KDA место</th>
                    <th>Урон ср.</th>
                    <th>Урон место</th>
                    <th>Очки</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyPlayerRatings.map((row) => (
                    <tr key={`${row.playedOnKey}-${row.nickname}`}>
                      <td>{formatRuDate(row.playedOn, timeZone)}</td>
                      <td>{row.seasonName}</td>
                      <td>{row.nickname}</td>
                      <td>{row.matches}</td>
                      <td>{row.avgKda.toFixed(2)}</td>
                      <td>{row.kdaRank}</td>
                      <td>{row.avgDamage}</td>
                      <td>{row.damageRank}</td>
                      <td>{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Пока нет дневного рейтинга.</p>
          )}
        </div>
      </section>

      <section className="content-grid single-column">
        <div className="panel">
          <h2 className="section-title">Рейтинг За Сезон</h2>
          {seasonPlayerRatings.length ? (
            <div className="table-scroll">
              <table className="players-table">
                <thead>
                  <tr>
                    <th>Сезон</th>
                    <th>Игрок</th>
                    <th>Игровые дни</th>
                    <th>KDA ср.</th>
                    <th>Урон ср.</th>
                    <th>Очки за день ср.</th>
                    <th>Очки за сезон</th>
                    <th>Тренд</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonPlayerRatings.map((row) => (
                    <tr key={`${row.seasonName}-${row.nickname}`}>
                      <td>{row.seasonName}</td>
                      <td>{row.nickname}</td>
                      <td>{row.days}</td>
                      <td>{row.avgKda.toFixed(2)}</td>
                      <td>{row.avgDamage}</td>
                      <td>{row.avgPointsPerDay}</td>
                      <td>{row.totalPoints}</td>
                      <td>{renderTrend(row.trend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Пока нет сезонного рейтинга.</p>
          )}
        </div>
      </section>

      <section className="content-grid single-column">
        <div className="panel">
          <h2 className="section-title">Сезоны</h2>
          <div className="match-list">
            {seasons.length ? (
              seasons.map((season) => (
                <div key={season.id} className="match-card compact-card">
                  <h3>{season.name}</h3>
                  <p className="muted">
                    {formatRuDate(season.startDate, timeZone)} - {formatRuDate(season.endDate, timeZone)}
                  </p>
                </div>
              ))
            ) : (
              <p className="muted">Сезоны пока не созданы.</p>
            )}
          </div>
        </div>
      </section>

      <section className="content-grid single-column">
        <div className="panel">
          <h2 className="section-title">Последние матчи</h2>
          <div className="match-list">
            {matches.length ? (
              matches.map((match) => (
                <article key={match.id} className="match-card">
                  <header>
                    <div>
                      <h3>{match.mapName}</h3>
                      <p className="muted" style={{ marginBottom: 0 }}>
                        Дата матча: {formatRuDate(match.playedOn, timeZone)}
                      </p>
                      <p className="muted" style={{ marginBottom: 0 }}>
                        Сезон: {match.season?.name ?? "не назначен"}
                      </p>
                    </div>
                    <span className="score-chip">
                      {match.scoreA}-{match.scoreB}
                    </span>
                  </header>

                  <div className="teams-grid">
                    {match.teams.map((team) => (
                      <div key={team.id} className="team-card">
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
                              <tr key={player.id}>
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
                </article>
              ))
            ) : (
              <p className="muted">
                В базе пока нет матчей.
              </p>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
