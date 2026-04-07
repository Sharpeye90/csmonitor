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
      take: 10,
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
        kda: item.deaths === 0 ? item.kills : Math.round((item.kills / item.deaths) * 100) / 100,
        avgHeadshotPct: Math.round((item.headshotPctTotal / item.matches) * 10) / 10
      }))
      .sort((left, right) => {
        if (left.seasonName !== right.seasonName) {
          return left.seasonName.localeCompare(right.seasonName, "ru");
        }

        return right.kills - left.kills;
      });
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const [matches, seasons, playerSeasonStats] = await Promise.all([
    getMatches(),
    getSeasons(),
    getPlayerSeasonStats()
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
                    <th>У</th>
                    <th>С</th>
                    <th>KDA</th>
                    <th>Урон</th>
                    <th>%ГЛ ср.</th>
                  </tr>
                </thead>
                <tbody>
                  {playerSeasonStats.map((row) => (
                    <tr key={`${row.seasonName}-${row.nickname}`}>
                      <td>{row.seasonName}</td>
                      <td>{row.nickname}</td>
                      <td>{row.matches}</td>
                      <td>{row.kills}</td>
                      <td>{row.deaths}</td>
                      <td>{row.kda.toFixed(2)}</td>
                      <td>{row.damage}</td>
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
