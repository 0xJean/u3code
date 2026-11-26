# u3code-hub

Open-source, self-hostable Team Control Plane for `u3code` (Cockpit, multi-repo workflow presets, automated PR reviewer triage, quality signals, Living Project Memory, and pluggable notifications).

## Quick start (Docker Compose)

```sh
cd infra/hub
cp .env.example .env
# Fill HUB_JWT_SECRET, HUB_ENCRYPTION_KEY, and GitHub OAuth / Webhook secrets
docker compose up -d --build
```

Verify health:

```sh
curl http://localhost:4310/healthz
```

## Key capabilities

- **Pluggable Auth & RBAC**: GitHub OAuth2 PKCE with optional `ALLOWED_GITHUB_ORGS` membership guard, short-lived JWTs + rotating refresh tokens, and multi-role workspace RBAC (`owner`, `pm`, `qa`, `dev`, `security`, `ops`, or custom roles).
- **Configurable Workflow Presets**: Built-in `lean` and `full-delivery` presets plus custom stages and role-enforced quality gates.
- **Generic Forge Webhooks**: Maps arbitrary branch pipelines (`integration` auto-merge vs `release` manual promotion), arbitrary automated review bots (Dotsbot, CodeRabbit, Macroscope, PR-Agent, etc.), and regex-extracted CI quality signals (such as diff coverage).
- **Zero-Gap Pulses**: Supports both explicit human thread pulses and automatic system pulses on integration merges or bot review blocks.
- **Pluggable Notifications**: Built-in `lark` interactive card driver (with `@` handles and HMAC signing) and `webhook` driver.
