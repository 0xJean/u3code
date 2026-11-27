# u3code-hub — Self-Hosted Team Engineering Cockpit

`u3code-hub` is the optional, open-source, self-hosted coordination service paired with `u3code`. It tracks cross-repository Work Items, Pulses, PR Review Triage, RBAC Gates, Multi-Repo Releases, Living Project Memory, and AI Digests.

## 1. Quick Trial (Local / LAN — No Domain Required)

You do **not** need a domain name (or even Docker/PostgreSQL!) to try `u3code-hub` locally.

### Option 1A: Zero-Docker Local Mode (1 second, embedded PGlite)

```sh
DATABASE_URL=pglite://.u3code-hub-data HUB_ALLOW_LOCAL_DEV_AUTH=true node infra/hub/src/index.ts
```

### Option 1B: Docker Compose (PostgreSQL 16 + Hub)

```sh
cd infra/hub
cp .env.example .env
# Edit .env: set HUB_JWT_SECRET, HUB_ENCRYPTION_KEY, and optionally GITHUB_SYNC_TOKEN
docker compose up -d --build
```

Verify health:

```sh
curl http://127.0.0.1:4310/healthz
```

Then open **Team Cockpit** in `u3code`, connect to `http://127.0.0.1:4310` (or your LAN/Tailscale IP), create a workspace/project in **Setup**, link your GitHub repos, and click **Sync PRs** to import existing open PRs immediately.

## 2. Production Deployment (With Domain + HTTPS)

A subdomain (e.g. `hub.yourdomain.com`) with HTTPS is recommended when enabling:

- Real-time **GitHub Webhooks** (`https://hub.yourdomain.com/webhooks/github`)
- **GitHub OAuth** sign-in (`https://hub.yourdomain.com/api/v1/auth/github/callback`)
- **Lark interactive card callbacks** (`https://hub.yourdomain.com/plugins/lark/callback`)

### Option A: Built-in Caddy Auto-HTTPS

1. Point a DNS `A` record for `hub.yourdomain.com` to your server IP (ports 80 & 443 open).
2. Set `HUB_PUBLIC_URL=https://hub.yourdomain.com` and `HUB_ALLOW_LOCAL_DEV_AUTH=false` in `.env`.
3. Uncomment the `caddy` service in `docker-compose.yml` and run:

```sh
HUB_DOMAIN=hub.yourdomain.com docker compose up -d --build
```

### Option B: Zero-Port Exposure (Cloudflare Tunnel or Tailscale Funnel)

- **Cloudflare Tunnel**: Point a tunnel hostname `hub.yourdomain.com` directly to `http://127.0.0.1:4310` — no public IP or open firewall ports needed.
- **Tailscale Funnel** (no custom domain required): Run `tailscale funnel 4310` to get a public HTTPS URL (`https://<machine>.<tailnet>.ts.net`) for testing webhooks immediately.

## 3. GitHub & Lark Setup Checklist

1. **GitHub OAuth App**: Set Authorization callback URL to `${HUB_PUBLIC_URL}/api/v1/auth/github/callback` and fill `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `ALLOWED_GITHUB_ORGS` in `.env`.
2. **GitHub Webhook**: Point Payload URL to `${HUB_PUBLIC_URL}/webhooks/github` (`application/json`), set the same secret as `GITHUB_WEBHOOK_SECRET`, and subscribe to `Pull requests`, `Pull request reviews`, `Check runs`, and `Deployment statuses`.
3. **Existing Open PRs**: Set `GITHUB_SYNC_TOKEN` (fine-grained PAT with `Pull requests: Read`) in `.env` and click **Sync PRs** in Cockpit **Setup**.
4. **Lark / Feishu**: Add a webhook channel in Cockpit **Setup**, bind your Lark `open_id` in **My Profile**, and click **Test** to verify signing + `@mention` delivery.

## 4. Plugins & Playbook Packs

See [`packs/README.md`](../../packs/README.md) for loading custom server plugins (`HUB_PLUGINS`) and installing reusable T3 Code Workflow & Skill packs (`node infra/hub/src/packs/cli.ts packs/bot-review-autofix`).
