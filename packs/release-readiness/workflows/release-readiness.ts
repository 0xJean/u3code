// T3 Code durable workflow installed into ~/.t3/workflows/ by `u3code` Playbook Pack.
// Audits cross-repository readiness from u3code-hub before requesting Production Go/No-Go.
const { workflow, agent, ask, stop, title } = T3;

export default workflow(
  "release-readiness",
  {
    version: 1,
    payload: Schema.Struct({
      versionLabel: Schema.String,
      workspaceId: Schema.optional(Schema.String),
      projectId: Schema.optional(Schema.String),
    }),
    asks: {
      goNoGo: "Production Go/No-Go",
    },
  },
  Effect.fn(function* (payload) {
    yield* title(`Release readiness audit: ${payload.versionLabel}`);

    const auditReport = yield* agent("audit-cockpit", {
      title: `Audit Team Hub readiness for ${payload.versionLabel}`,
      returns: Schema.String,
      prompt: [
        `Audit release readiness for version ${payload.versionLabel}.`,
        "1. Call `team_hub_get_context` and `team_hub_get_review_queue`.",
        "2. List all work items targeting this release along with unverified ACs, active blockers, and any bot_blocked / ci_blocked PRs.",
        "3. Produce a crisp Go/No-Go readiness report in Markdown.",
      ].join("\n"),
    });

    const answer = yield* ask("go-no-go", {
      kind: "goNoGo",
      title: `Go/No-Go for ${payload.versionLabel}`,
      description: auditReport,
      choices: [
        { value: "go", description: "Proceed with release sign-off" },
        { value: "hold", description: "Hold release until blockers are cleared", requireReason: true },
      ],
    });

    if (Option.isNone(answer) || answer.value.choice !== "go") {
      return yield* stop(`Release ${payload.versionLabel} held.`);
    }

    return { versionLabel: payload.versionLabel, decision: "go" };
  }),
);
