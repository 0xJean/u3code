export interface HubConfig {
  readonly port: number;
  readonly host: string;
  readonly publicUrl: string;
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly encryptionKey: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly githubClientId: string | null;
  readonly githubClientSecret: string | null;
  readonly githubWebhookSecret: string | null;
  readonly allowedGithubOrgs: readonly string[];
  readonly allowLocalDevAuth: boolean;
  readonly llmBaseUrl: string;
  readonly llmApiKey: string | null;
  readonly llmModel: string;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export function loadHubConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const port = Number.parseInt(env.PORT ?? "4310", 10);
  const jwtSecret = env.HUB_JWT_SECRET ?? "dev-only-change-me-in-production-32bytes!";
  return {
    port: Number.isFinite(port) && port > 0 ? port : 4310,
    host: env.HOST ?? "0.0.0.0",
    publicUrl: (env.HUB_PUBLIC_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, ""),
    databaseUrl: env.DATABASE_URL ?? "postgres://u3code:u3code@localhost:5432/u3code_hub",
    jwtSecret,
    encryptionKey: env.HUB_ENCRYPTION_KEY ?? jwtSecret,
    accessTokenTtlSeconds: Number.parseInt(env.HUB_ACCESS_TTL_SECONDS ?? "900", 10) || 900,
    refreshTokenTtlSeconds:
      Number.parseInt(env.HUB_REFRESH_TTL_SECONDS ?? String(30 * 24 * 3600), 10) || 30 * 24 * 3600,
    githubClientId: env.GITHUB_CLIENT_ID?.trim() || null,
    githubClientSecret: env.GITHUB_CLIENT_SECRET?.trim() || null,
    githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET?.trim() || null,
    allowedGithubOrgs: parseList(env.ALLOWED_GITHUB_ORGS),
    allowLocalDevAuth: env.HUB_ALLOW_LOCAL_DEV_AUTH === "true",
    llmBaseUrl: (env.HUB_LLM_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, ""),
    llmApiKey: env.HUB_LLM_API_KEY?.trim() || null,
    llmModel: env.HUB_LLM_MODEL?.trim() || "gpt-4.1-mini",
  };
}
