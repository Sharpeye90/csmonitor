export type ParsedPlayer = {
  nickname: string;
  kills: number;
  deaths: number;
  assists: number | null;
  damage: number;
  headshotPct: number;
  kda: string;
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

export type SavedMatch = {
  id: string;
  uploadedAt: string;
  playedOn: string;
  mapName: string;
  scoreA: number;
  scoreB: number;
  teams: ParsedTeam[];
};
