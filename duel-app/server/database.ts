import Database from "better-sqlite3";
import type {
  LeaderboardEntry,
  PublicProfile,
  RaceResult,
} from "../shared/protocol.js";

export class DuelDatabase {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        github_id INTEGER PRIMARY KEY,
        login TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        avatar_url TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS races (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_seconds INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS race_results (
        race_id TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
        side TEXT NOT NULL CHECK(side IN ('L','R')),
        github_id INTEGER NOT NULL REFERENCES profiles(github_id),
        wpm REAL NOT NULL,
        raw REAL NOT NULL,
        accuracy REAL NOT NULL,
        consistency REAL NOT NULL,
        correct_chars INTEGER NOT NULL,
        incorrect_chars INTEGER NOT NULL,
        finished_at INTEGER NOT NULL,
        PRIMARY KEY (race_id, side)
      );
    `);
  }

  getProfile(login: string, maxAgeMs = 86_400_000): PublicProfile | undefined {
    const row = this.db
      .prepare(`SELECT * FROM profiles WHERE login = ? AND fetched_at > ?`)
      .get(login, Date.now() - maxAgeMs) as Record<string, unknown> | undefined;
    return row ? mapProfile(row) : undefined;
  }

  saveProfile(profile: PublicProfile): void {
    this.db
      .prepare(`
      INSERT INTO profiles (github_id, login, display_name, avatar_url, fetched_at)
      VALUES (@githubId, @login, @displayName, @avatarUrl, @fetchedAt)
      ON CONFLICT(github_id) DO UPDATE SET login=excluded.login, display_name=excluded.display_name,
      avatar_url=excluded.avatar_url, fetched_at=excluded.fetched_at
    `)
      .run({ ...profile, fetchedAt: Date.now() });
  }

  saveRace(
    id: string,
    startedAt: number,
    durationSeconds: number,
    results: RaceResult[],
  ): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(`INSERT OR REPLACE INTO races VALUES (?, ?, ?, ?)`)
        .run(id, startedAt, Date.now(), durationSeconds);
      const statement = this.db.prepare(`
        INSERT OR REPLACE INTO race_results
        (race_id, side, github_id, wpm, raw, accuracy, consistency, correct_chars, incorrect_chars, finished_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const result of results) {
        this.saveProfile(result.profile);
        statement.run(
          id,
          result.side,
          result.profile.githubId,
          result.wpm,
          result.raw,
          result.accuracy,
          result.consistency,
          result.correctChars,
          result.incorrectChars,
          result.finishedAt,
        );
      }
    });
    transaction();
  }

  leaderboard(): LeaderboardEntry[] {
    return this.db
      .prepare(`
      SELECT p.github_id, p.login, p.display_name, p.avatar_url,
             MAX(r.wpm) best_wpm,
             (SELECT rr.raw FROM race_results rr WHERE rr.github_id=p.github_id ORDER BY rr.wpm DESC LIMIT 1) best_raw,
             (SELECT rr.accuracy FROM race_results rr WHERE rr.github_id=p.github_id ORDER BY rr.wpm DESC LIMIT 1) accuracy,
             COUNT(*) races, MAX(r.finished_at) last_played_at
      FROM race_results r JOIN profiles p ON p.github_id=r.github_id
      GROUP BY p.github_id ORDER BY best_wpm DESC, accuracy DESC LIMIT 100
    `)
      .all()
      .map((row) => {
        const value = row as Record<string, unknown>;
        return {
          githubId: Number(value.github_id),
          login: String(value.login),
          displayName: String(value.display_name),
          avatarUrl: String(value.avatar_url),
          bestWpm: Number(value.best_wpm),
          bestRaw: Number(value.best_raw),
          accuracy: Number(value.accuracy),
          races: Number(value.races),
          lastPlayedAt: Number(value.last_played_at),
        };
      });
  }
}

function mapProfile(row: Record<string, unknown>): PublicProfile {
  return {
    githubId: Number(row.github_id),
    login: String(row.login),
    displayName: String(row.display_name),
    avatarUrl: String(row.avatar_url),
  };
}
