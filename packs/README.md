# u3code Playbook Packs & Hub Plugins

`u3code` keeps its core engine and `u3code-hub` 100% generic and open-source. Team-specific delivery processes, automated pipelines, and external integrations live in two lightweight layers:

## 1. Hub Plugins (`HubPlugin` — server-side extensions)

A Hub plugin is a TypeScript/ESM module exporting `defineHubPlugin({ id, name, version, description, register(ctx) })`. Four extension points are available:

- `ctx.registerNotifier(driver)` — add custom notification channels (e.g. Lark, Slack, WeCom, DingTalk, Email).
- `ctx.registerWorkflowPreset(preset)` — register custom project workflow stages & RBAC gate rules (automatically surfaced in Cockpit **Setup → Create Project**).
- `ctx.onEvent(eventType, handler)` — react to Hub lifecycle events (`change_request.updated`, `gate.updated`, `pulse.created`, `release.updated`, `work_item.changed`, or `"*"`).
- `ctx.registerRoute(subPath, honoApp)` — mount custom callback routes under `/plugins/<pluginId>/<subPath>` (e.g. interactive Lark card gate approvals at `/plugins/lark/callback` or CI status webhooks).

Built-in reference plugins live under `infra/hub/src/plugins/builtin/` (`core-workflows`, `lark`, `webhook`, `automation-relay`). Load external plugins at startup via:

```sh
HUB_PLUGINS=./my-plugin.ts,@org/u3code-hub-plugin-linear npm --prefix infra/hub run start
```

## 2. Playbook Packs (`u3code-pack.json` — shareable team process bundles)

A Playbook Pack bundles **T3 Code durable Workflows (`workflows/*.ts`)**, **Agent Skills (`skills/*/SKILL.md`)**, and **recommended Hub presets/directives** into a portable directory or Git repo.

### Bundled Reference Packs

- [`packs/bot-review-autofix`](./bot-review-autofix/u3code-pack.json) — reacts to `pr.bot_blocked` events relayed from Hub and equips agents with the `workitem-delivery` skill.
- [`packs/release-readiness`](./release-readiness/u3code-pack.json) — cross-repo pre-release audit workflow and `release-checklist` skill.

### Install a Pack

```sh
node infra/hub/src/packs/cli.ts packs/bot-review-autofix
# Preview without writing files:
node infra/hub/src/packs/cli.ts packs/bot-review-autofix --dry-run
# Overwrite existing files:
node infra/hub/src/packs/cli.ts packs/bot-review-autofix --force
```

Workflows install into `$T3CODE_WORKFLOWS` (default `~/.t3/workflows/`) and skills install into `~/.agents/skills/`.
