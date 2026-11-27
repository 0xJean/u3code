// T3 Code durable workflow installed into ~/.t3/workflows/ by `u3code` Playbook Pack.
// Triggered by u3code-hub's `automation-relay` plugin when a PR is blocked by an automated reviewer.
const { workflow, agent, ask, stop, title } = T3;

const BotBlockedPayload = Schema.Struct({
  trigger: Schema.String,
  event: Schema.Struct({
    repoFullName: Schema.optional(Schema.String),
    number: Schema.optional(Schema.Number),
    workspaceId: Schema.optional(Schema.String),
    workItemId: Schema.optional(Schema.String),
  }),
});

export default workflow(
  "bot-review-autofix",
  {
    version: 1,
    payload: BotBlockedPayload,
    hooks: {
      hubAutomation: {
        description: "Receive signed Hub automation-relay events on pr.bot_blocked",
      },
    },
    asks: {
      pushConfirm: "PR Autofix Approval",
    },
  },
  Effect.fn(function* (payload) {
    if (payload.trigger !== "pr.bot_blocked") {
      return yield* stop(`Ignored non-bot-blocked trigger: ${payload.trigger}`);
    }

    const repo = payload.event.repoFullName ?? "unknown/repo";
    const prNumber = payload.event.number ?? 0;
    yield* title(`Autofix bot review on ${repo}#${prNumber}`);

    const summary = yield* agent("investigate-and-fix", {
      title: `Fix automated review findings on ${repo}#${prNumber}`,
      returns: Schema.String,
      prompt: [
        `An automated reviewer blocked pull request ${repo}#${prNumber}.`,
        "1. Call `team_hub_get_review_queue` (bucket: 'bot_blocked') to inspect the exact reviewer findings.",
        "2. If linked to a WorkItem, call `team_hub_get_work_item` to check acceptance criteria and locked project directives.",
        "3. Apply minimal, clean fixes on the PR branch and run relevant unit tests.",
        "4. Return a concise summary of what you changed and which tests passed (do NOT push until approved).",
      ].join("\n"),
    });

    const decision = yield* ask("confirm-push", {
      kind: "pushConfirm",
      title: `Push autofix for ${repo}#${prNumber}?`,
      description: summary,
      choices: [
        { value: "approve", description: "Push fix and sync a Team Hub pulse" },
        { value: "hold", description: "Keep changes local for manual review" },
      ],
    });

    if (Option.isNone(decision) || decision.value.choice !== "approve") {
      return yield* stop("Held local changes for manual inspection.");
    }

    yield* agent("push-and-pulse", {
      title: `Push and sync pulse for ${repo}#${prNumber}`,
      prompt: [
        `Push the verified fix for ${repo}#${prNumber} and call \`team_hub_publish_pulse\` with a concise summary.`,
        `Previous summary: ${summary}`,
      ].join("\n"),
    });

    return { repo, prNumber, status: "pushed" };
  }),
);
