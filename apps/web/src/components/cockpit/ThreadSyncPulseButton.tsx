import type {
  CockpitOverview,
  EnvironmentId,
  TeamHubStatusResult,
  ThreadId,
} from "@t3tools/contracts";
import type { WorkHealth } from "@u3code/hub-contracts";
import { T, useGT } from "gt-react";
import { RadioIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { SharedTooltipTrigger } from "~/components/ui/shared-tooltip";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatCockpitCommandError } from "./cockpitError";

interface ThreadSyncPulseButtonProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly threadTitle: string;
}

export function ThreadSyncPulseButton({
  environmentId,
  threadId,
  threadTitle,
}: ThreadSyncPulseButtonProps) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [hubStatus, setHubStatus] = useState<TeamHubStatusResult | null>(null);
  const [overview, setOverview] = useState<CockpitOverview | null>(null);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState("");
  const [health, setHealth] = useState<WorkHealth>("on_track");
  const [doneSummary, setDoneSummary] = useState("");
  const [decisionsText, setDecisionsText] = useState("");
  const [blockersText, setBlockersText] = useState("");
  const [nextStep, setNextStep] = useState("");

  const fetchStatus = useAtomCommand(teamHubEnvironment.status, { reportFailure: false });
  const fetchOverview = useAtomCommand(teamHubEnvironment.getOverview, { reportFailure: false });
  const extractDraft = useAtomCommand(teamHubEnvironment.extractPulseDraft, {
    reportFailure: false,
  });
  const publishPulse = useAtomCommand(teamHubEnvironment.publishPulse, { reportFailure: false });

  const handleOpen = async () => {
    setOpen(true);
    setLoading(true);
    setErrorMessage(null);

    const [statusRes, draftRes] = await Promise.all([
      fetchStatus({ environmentId, input: {} }),
      extractDraft({
        environmentId,
        input: {
          threadId,
          threadTitle,
        },
      }),
    ]);

    if (draftRes._tag === "Success") {
      setHealth(draftRes.value.health);
      setDoneSummary(draftRes.value.doneSummary);
      setDecisionsText(draftRes.value.decisions.join("\n"));
      setBlockersText(draftRes.value.blockers.map((b) => b.text).join("\n"));
      setNextStep(draftRes.value.nextStep);
    }

    if (statusRes._tag !== "Success") {
      setLoading(false);
      setErrorMessage(formatCockpitCommandError(statusRes, gt("Unable to check Team Hub status.")));
      return;
    }

    setHubStatus(statusRes.value);
    const firstWorkspace = statusRes.value.me?.workspaces[0];
    if (!statusRes.value.connected || !firstWorkspace) {
      setOverview(null);
      setLoading(false);
      return;
    }

    const overviewRes = await fetchOverview({
      environmentId,
      input: { workspaceId: firstWorkspace.id },
    });
    setLoading(false);

    if (overviewRes._tag === "Success") {
      setOverview(overviewRes.value);
      const matchedCode = draftRes._tag === "Success" ? draftRes.value.workItemCode : null;
      const matchedCard = matchedCode
        ? overviewRes.value.cards.find(
            (card) => card.workItem.code.toUpperCase() === matchedCode.toUpperCase(),
          )
        : undefined;
      setSelectedWorkItemId(
        matchedCard?.workItem.id ?? overviewRes.value.cards[0]?.workItem.id ?? "",
      );
    } else {
      setErrorMessage(
        formatCockpitCommandError(overviewRes, gt("Failed to load work items from Team Hub.")),
      );
    }
  };

  const handlePublish = async () => {
    if (!selectedWorkItemId) {
      setErrorMessage(gt("Select a work item first."));
      return;
    }
    if (!doneSummary.trim()) {
      setErrorMessage(gt("Enter a brief summary of progress."));
      return;
    }

    const decisions = decisionsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const blockers = blockersText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text) => ({ text, needsAttentionRoles: ["owner"] }));

    setPublishing(true);
    setErrorMessage(null);
    const res = await publishPulse({
      environmentId,
      input: {
        workItemId: selectedWorkItemId,
        pulse: {
          sourceType: "human_thread",
          sourceThreadId: threadId,
          health,
          doneSummary: doneSummary.trim(),
          decisions,
          blockers,
          nextStep: nextStep.trim(),
        },
      },
    });
    setPublishing(false);

    if (res._tag === "Success") {
      setOpen(false);
      toastManager.add({
        title: gt("Pulse synced to Team Hub"),
        type: "success",
      });
    } else {
      setErrorMessage(formatCockpitCommandError(res, gt("Failed to publish pulse.")));
    }
  };

  return (
    <>
      <div className="shrink-0">
        <SharedTooltipTrigger
          render={
            <Button
              aria-label={gt("Sync progress pulse to Team Hub")}
              size="xs"
              variant="ghost-muted"
              onClick={() => void handleOpen()}
            >
              <RadioIcon />
              <span>
                <T>Sync Pulse</T>
              </span>
            </Button>
          }
          label={gt("Extract a structured progress pulse from this thread and sync to Team Hub")}
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              <T>Sync Thread Pulse</T>
            </DialogTitle>
            <DialogDescription>
              <T>
                Publish a structured update (progress, decisions, blockers) to Team Hub without
                uploading your full chat transcript.
              </T>
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
            {loading ? (
              <p className="text-sm text-muted-foreground">
                <T>Preparing pulse draft...</T>
              </p>
            ) : !hubStatus?.connected ? (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="font-medium text-foreground">
                  <T>Not connected to Team Hub</T>
                </p>
                <p className="text-xs text-muted-foreground">
                  <T>Open Team Cockpit from the sidebar to connect to your u3code-hub server.</T>
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="pulse-work-item"
                  >
                    <T>Work Item</T>
                  </label>
                  <select
                    id="pulse-work-item"
                    className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    value={selectedWorkItemId}
                    onChange={(event) => setSelectedWorkItemId(event.target.value)}
                  >
                    {overview?.cards.map((card) => (
                      <option key={card.workItem.id} value={card.workItem.id}>
                        {card.workItem.code}: {card.workItem.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">
                    <T>Health</T>
                  </span>
                  <div className="flex items-center gap-2">
                    {(["on_track", "at_risk", "blocked"] as const).map((option) => (
                      <Button
                        key={option}
                        size="xs"
                        variant={health === option ? "default" : "outline"}
                        onClick={() => setHealth(option)}
                      >
                        <Badge
                          size="sm"
                          variant={
                            option === "blocked"
                              ? "error"
                              : option === "at_risk"
                                ? "warning"
                                : "success"
                          }
                        >
                          {option === "on_track"
                            ? gt("On track")
                            : option === "at_risk"
                              ? gt("At risk")
                              : gt("Blocked")}
                        </Badge>
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="pulse-summary"
                  >
                    <T>Progress Summary</T>
                  </label>
                  <Textarea
                    id="pulse-summary"
                    rows={2}
                    value={doneSummary}
                    onChange={(event) => setDoneSummary(event.target.value)}
                  />
                </div>

                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="pulse-decisions"
                  >
                    <T>Key Decisions (one per line)</T>
                  </label>
                  <Textarea
                    id="pulse-decisions"
                    rows={2}
                    placeholder={gt("e.g. Use transactional outbox instead of pubsub")}
                    value={decisionsText}
                    onChange={(event) => setDecisionsText(event.target.value)}
                  />
                </div>

                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="pulse-blockers"
                  >
                    <T>Blockers / Escalations (one per line)</T>
                  </label>
                  <Textarea
                    id="pulse-blockers"
                    rows={2}
                    placeholder={gt("e.g. Need owner decision on retention policy")}
                    value={blockersText}
                    onChange={(event) => setBlockersText(event.target.value)}
                  />
                </div>

                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="pulse-next-step"
                  >
                    <T>Next Step</T>
                  </label>
                  <Input
                    id="pulse-next-step"
                    value={nextStep}
                    onChange={(event) => setNextStep(event.target.value)}
                  />
                </div>
              </div>
            )}

            {errorMessage ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {errorMessage}
              </p>
            ) : null}
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </DialogClose>
            {hubStatus?.connected ? (
              <Button disabled={publishing || loading} onClick={() => void handlePublish()}>
                {publishing ? <T>Syncing...</T> : <T>Publish Pulse</T>}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
