export type ParsedPlayer = {
  nickname: string;
  kills: number;
  deaths: number;
  assists: number | null;
  damage: number;
  headshotPct: number;
  kda: number;
};

export type ParsedTeam = {
  name: string;
  side: string;
  score: number;
  players: ParsedPlayer[];
};

export type ParsedMatch = {
  mapName: string;
  score: string;
  teams: ParsedTeam[];
};

export type SeasonSummary = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
};

export type SavedMatch = {
  id: string;
  uploadedAt: string;
  uploadedAtIso?: string;
  playedOn: string;
  playedOnIso?: string;
  mapName: string;
  scoreA: number;
  scoreB: number;
  season: SeasonSummary | null;
  teams: ParsedTeam[];
};

export type ParsePreview = {
  mapName: string;
  scoreA: number;
  scoreB: number;
  teams: ParsedTeam[];
};
