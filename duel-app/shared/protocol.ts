export type Side = "L" | "R";
export type RoomPhase =
  | "registration"
  | "lobby"
  | "countdown"
  | "racing"
  | "results";

export type PublicProfile = {
  githubId: number;
  login: string;
  displayName: string;
  avatarUrl: string;
};

export type StationState = {
  side: Side;
  profile: PublicProfile;
  practiceCount: number;
  ready: boolean;
  connected: boolean;
  cursorIndex: number;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  afkWarningAt?: number;
  afkResetAt?: number;
};

export type RaceDefinition = {
  id: string;
  text: string;
  startAt: number;
  durationSeconds: number;
};

export type RaceResult = {
  side: Side;
  profile: PublicProfile;
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
  correctChars: number;
  incorrectChars: number;
  finishedAt: number;
};

export type LeaderboardEntry = {
  bestWpm: number;
  bestRaw: number;
  accuracy: number;
  races: number;
  lastPlayedAt: number;
} & PublicProfile;

export type RoomSnapshot = {
  phase: RoomPhase;
  stations: Partial<Record<Side, StationState>>;
  reservations: Partial<
    Record<Side, { selectedAt: number; expiresAt: number }>
  >;
  race?: RaceDefinition;
  results: RaceResult[];
  leaderboard: LeaderboardEntry[];
  serverNow: number;
  resultsResetAt?: number;
};

export type ClientMessage =
  | { type: "hello"; role: "station" | "spectator"; stationToken?: string }
  | { type: "reserveSide"; side: Side; selectedAt: number }
  | { type: "claim"; side: Side; githubLogin: string }
  | { type: "practiceStart" }
  | { type: "practiceComplete" }
  | { type: "skipPractice" }
  | {
      type: "progress";
      sequence: number;
      cursorIndex: number;
      wpm: number;
      raw?: number;
      accuracy: number;
    }
  | {
      type: "finish";
      result: Omit<RaceResult, "side" | "profile" | "finishedAt">;
    }
  | { type: "release" }
  | { type: "activity" }
  | { type: "clientLog"; level: "warn" | "error"; message: string };

export type ServerMessage =
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | {
      type: "claimed";
      side: Side;
      stationToken: string;
      profile: PublicProfile;
    }
  | {
      type: "reservation";
      side: Side;
      selectedAt: number;
      granted: boolean;
      message?: string;
    }
  | { type: "error"; message: string }
  | { type: "control"; action: "refresh" }
  | { type: "pong"; serverNow: number };

export type AdminTarget = Side | "leaderboard" | "all";

export type AdminLogEntry = {
  id: number;
  at: number;
  level: "info" | "warn" | "error";
  source: "backend" | Side | "leaderboard";
  message: string;
};

export type AdminStatus = {
  snapshot: RoomSnapshot;
  clients: { source: Side | "leaderboard"; connected: boolean }[];
  logs: AdminLogEntry[];
};
