import type { PublicProfile } from "../shared/protocol.js";
import type { DuelDatabase } from "./database.js";

const validLogin = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;

export async function resolveGithubProfile(
  login: string,
  database: DuelDatabase,
): Promise<PublicProfile> {
  const normalized = login.trim();
  if (!validLogin.test(normalized)) {
    throw new ProfileError(400, "Enter a valid GitHub username.");
  }
  const cached = database.getProfile(normalized);
  if (cached) return cached;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "monkeytype-duel",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const githubToken = process.env.GITHUB_TOKEN;
  if (githubToken !== undefined && githubToken !== "") {
    headers.Authorization = `Bearer ${githubToken}`;
  }
  const response = await fetch(
    `https://api.github.com/users/${encodeURIComponent(normalized)}`,
    { headers },
  );
  if (response.status === 404) {
    throw new ProfileError(404, "GitHub user not found.");
  }
  if (!response.ok) {
    throw new ProfileError(503, "GitHub lookup is temporarily unavailable.");
  }
  const user = (await response.json()) as {
    id: number;
    login: string;
    name: string | null;
    avatar_url: string;
  };
  const profile = {
    githubId: user.id,
    login: user.login,
    displayName: user.name?.trim() ?? user.login,
    avatarUrl: user.avatar_url,
  };
  database.saveProfile(profile);
  return profile;
}

export class ProfileError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
