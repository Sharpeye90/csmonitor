import { prisma } from "@/lib/db";
import { formatRuDate } from "@/lib/date";
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

export default async function HomePage() {
  const [matches, seasons] = await Promise.all([getMatches(), getSeasons()]);

  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-card">
          <span className="eyebrow">CS2 Match Ingest</span>
          <h1>Парсер скриншотов результатов CS2</h1>
          <p>
            Веб-приложение принимает скриншот итогового табло, вытаскивает карту, счет,
            список игроков и индивидуальную статистику, а затем сохраняет матч в PostgreSQL.
          </p>

          <div className="stats-strip">
            <div className="stat-box">
              <strong>{matches.length}</strong>
              <span>матчей в базе</span>
            </div>
            <div className="stat-box">
              <strong>2 команды</strong>
              <span>на каждый матч</span>
            </div>
            <div className="stat-box">
              <strong>Local OCR</strong>
              <span>парсинг внутри сервиса</span>
            </div>
          </div>
        </div>

        <UploadForm
          seasons={seasons.map((season) => ({
            id: season.id,
            name: season.name,
            startDate: season.startDate.toISOString(),
            endDate: season.endDate.toISOString()
          }))}
        />
      </section>

      <section className="content-grid">
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
                </article>
              ))
            ) : (
              <p className="muted">
                В базе пока нет матчей. Загрузите первый итоговый скриншот справа.
              </p>
            )}
          </div>
        </div>

        <div className="panel">
          <h2 className="section-title">Что сохраняется</h2>
          <div className="match-list">
            <div className="match-card">
              <h3>Дата матча</h3>
              <p className="muted">
                Берется из момента загрузки скриншота. Если загрузка произошла до 06:00 по локальному
                часовому поясу приложения, матч записывается предыдущим днем.
              </p>
            </div>
            <div className="match-card">
              <h3>Сезоны</h3>
              <p className="muted">
                Можно создать сезоны с диапазоном дат, а затем либо выбирать сезон вручную при загрузке,
                либо позволить приложению автоматически определить сезон по дате матча.
              </p>
            </div>
            <div className="match-card">
              <h3>Структура матча</h3>
              <p className="muted">
                Сохраняются карта, итоговый счет, две команды и игроки с убийствами, смертями, уроном,
                %ГЛ и строковым KDA в формате Убийства/Смерти.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <SeasonForm />

        <div className="panel">
          <h2 className="section-title">Сезоны</h2>
          <div className="match-list">
            {seasons.length ? (
              seasons.map((season) => (
                <div key={season.id} className="match-card">
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
    </main>
  );
}
