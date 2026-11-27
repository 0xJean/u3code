import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import type {
  ChangeRequestAudit,
  CockpitWorkItemCard,
  Project,
  ProjectMemory,
  ProjectRepo,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import {
  AlertTriangleIcon,
  BotIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  Link2Icon,
  MessageSquareCodeIcon,
  ShieldCheckIcon,
  UnlinkIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { PullRequestDetailPanel } from "~/components/pullRequest/PullRequestDetailPanel";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { isTerminalFocused } from "~/lib/terminalFocus";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import {
  CockpitDiffStat,
  CockpitPriorityDot,
  CockpitSectionHeader,
  CockpitStatusDot,
  CockpitSurface,
  CockpitSurfaceRow,
  type CockpitTone,
} from "./CockpitPrimitives";
import {
  buildPullRequestActionPrompt,
  findMatchingWorkspaceProject,
  pickMatchingWorkspaceProject,
} from "./workItemPrompt";

export interface CockpitPullRequestPaneProps {
  readonly environmentId: EnvironmentId;
  readonly changeRequest: ChangeRequestAudit;
  readonly cards: ReadonlyArray<CockpitWorkItemCard>;
  readonly project: Project | null;
  readonly memory: ProjectMemory | null;
  readonly repos: ReadonlyArray<ProjectRepo>;
  readonly onClose: () => void;
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onLinkChangeRequest: (changeRequestId: string, workItemId: string | null) => void;
}

type PaneView = "native" | "triage";

function getShortcutContext() {
  return {
    terminalFocus: isTerminalFocused(),
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    modelPickerOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

function hostFromPullRequestUrl(url: string): string | undefined {
  try {
    return new URL(url).host || undefined;
  } catch {
    return undefined;
  }
}

function ciStatusTone(ciStatus: ChangeRequestAudit["qualitySignals"]["ciStatus"]): CockpitTone {
  if (ciStatus === "failure") return "error";
  if (ciStatus === "success") return "success";
  return "neutral";
}

function ciStatusLabel(
  ciStatus: ChangeRequestAudit["qualitySignals"]["ciStatus"],
  gt: ReturnType<typeof useGT>,
): string {
  if (ciStatus === "failure") return gt("Failed");
  if (ciStatus === "success") return gt("Passed");
  return gt("Pending");
}

function reviewerStateLabel(state: string, gt: ReturnType<typeof useGT>): string {
  switch (state) {
    case "changes_requested":
      return gt("Changes Requested");
    case "approved":
      return gt("Approved");
    case "commented":
      return gt("Commented");
    case "pending":
      return gt("Pending");
    default:
      return state;
  }
}

function riskLevelLabel(
  riskLevel: "low" | "medium" | "high" | "unknown",
  gt: ReturnType<typeof useGT>,
): string {
  switch (riskLevel) {
    case "high":
      return gt("High Risk");
    case "medium":
      return gt("Medium Risk");
    case "low":
      return gt("Low Risk");
    case "unknown":
      return gt("Unknown");
  }
}

function humanReviewLabel(
  state: ChangeRequestAudit["humanReviewState"],
  gt: ReturnType<typeof useGT>,
): string {
  switch (state) {
    case "approved":
      return gt("Human Approved");
    case "changes_requested":
      return gt("Changes Requested");
    case "pending":
      return gt("Awaiting Review");
  }
}

export function CockpitPullRequestPane({
  environmentId,
  changeRequest,
  cards,
  project,
  memory,
  repos,
  onClose,
  onOpenWorkItem,
  onLinkChangeRequest,
}: CockpitPullRequestPaneProps) {
  const gt = useGT();
  const localProjects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const [paneView, setPaneView] = useState<PaneView>("triage");
  const [chosenLocalProjectByRepo, setChosenLocalProjectByRepo] = useState<Record<string, string>>(
    {},
  );
  const [selectedWorkItemId, setSelectedWorkItemId] = useState("");
  const [startingAgent, setStartingAgent] = useState<"fix" | "review" | null>(null);

  const envLocalProjects = localProjects.filter((p) => p.environmentId === environmentId);
  const candidateProjects = envLocalProjects.length > 0 ? envLocalProjects : localProjects;
  const exactMatchedProject = findMatchingWorkspaceProject(candidateProjects, [
    { repoFullName: changeRequest.repoFullName },
  ]);
  const fallbackMatchedProject =
    exactMatchedProject ?? pickMatchingWorkspaceProject(candidateProjects, repos);
  const chosenKeyForRepo = chosenLocalProjectByRepo[changeRequest.repoFullName] ?? "";
  const selectedLocalProject =
    localProjects.find((p) => `${p.environmentId}:${p.id}` === chosenKeyForRepo) ??
    fallbackMatchedProject;

  const linkedCard = changeRequest.workItemId
    ? (cards.find((c) => c.workItem.id === changeRequest.workItemId) ?? null)
    : null;
  const effectiveLinkTargetId =
    (selectedWorkItemId && cards.some((c) => c.workItem.id === selectedWorkItemId)
      ? selectedWorkItemId
      : cards[0]?.workItem.id) ?? "";
  const hasBlockers =
    changeRequest.automatedReview.status === "blocking" ||
    changeRequest.qualitySignals.ciStatus === "failure";
  const host = hostFromPullRequestUrl(changeRequest.url);
  const qualitySignals = Object.values(changeRequest.qualitySignals.signals);
  const ciTone = ciStatusTone(changeRequest.qualitySignals.ciStatus);

  const handleLaunchAgentThread = async (mode: "fix" | "review") => {
    if (!selectedLocalProject) {
      toastManager.add({
        title: gt("Add a local workspace repository first to run an Agent thread."),
        type: "warning",
      });
      return;
    }
    setStartingAgent(mode);
    const prompt = buildPullRequestActionPrompt({
      mode,
      changeRequest,
      linkedWorkItem: linkedCard?.workItem ?? null,
      project,
      memory,
    });
    await handleNewThread(
      scopeProjectRef(selectedLocalProject.environmentId, selectedLocalProject.id),
      {
        branch: changeRequest.headBranch || null,
        envMode: "worktree",
        prompt,
      },
    );
    setStartingAgent(null);
  };

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-border/70 bg-background md:w-[min(46vw,640px)] md:shrink-0">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <PullRequestGlyph.pullRequest className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono text-xs font-medium text-foreground">
            {changeRequest.repoFullName}#{changeRequest.number}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <ToggleGroup
            size="segmented"
            variant="segmented"
            value={[paneView]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "native" || value === "triage") setPaneView(value);
            }}
          >
            <Toggle value="triage">
              <T>Triage & Agent</T>
            </Toggle>
            <Toggle value="native">
              <T>Diff & Review</T>
            </Toggle>
          </ToggleGroup>

          <Button
            aria-label={gt("Open on GitHub")}
            render={
              <a href={changeRequest.url} rel="noreferrer" target="_blank">
                <ExternalLinkIcon />
              </a>
            }
            size="icon-xs"
            variant="ghost-muted"
          />

          <Button
            aria-label={gt("Close pull request panel")}
            size="icon-xs"
            variant="ghost-muted"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
      </div>

      {paneView === "native" ? (
        selectedLocalProject ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {localProjects.length > 1 || !exactMatchedProject ? (
              <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/20 px-4 py-1.5 text-2xs text-muted-foreground">
                <span className="truncate">
                  <T>Workspace repository</T>
                </span>
                <div className="w-44 shrink-0">
                  <Select
                    value={`${selectedLocalProject.environmentId}:${selectedLocalProject.id}`}
                    onValueChange={(val) => {
                      if (val) {
                        setChosenLocalProjectByRepo((prev) => ({
                          ...prev,
                          [changeRequest.repoFullName]: val,
                        }));
                      }
                    }}
                  >
                    <SelectTrigger size="compact">
                      <SelectValue>{selectedLocalProject.title}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {localProjects.map((proj) => (
                        <SelectItem
                          key={`${proj.environmentId}:${proj.id}`}
                          value={`${proj.environmentId}:${proj.id}`}
                        >
                          {proj.title}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-hidden">
              <PullRequestDetailPanel
                key={`${selectedLocalProject.environmentId}:${selectedLocalProject.id}:${changeRequest.repoFullName}#${changeRequest.number}`}
                environmentId={selectedLocalProject.environmentId}
                getShortcutContext={getShortcutContext}
                onClose={onClose}
                reference={{
                  projectId: selectedLocalProject.id,
                  repository: changeRequest.repoFullName,
                  number: changeRequest.number,
                  ...(host ? { host } : {}),
                }}
                shortcutsEnabled
              />
            </div>
          </div>
        ) : (
          <Empty size="compact">
            <EmptyMedia variant="icon">
              <PullRequestGlyph.pullRequest />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>
                <T>No local project linked</T>
              </EmptyTitle>
              <EmptyDescription>
                <T>
                  Add this repository folder to U3 Code to inspect native code diffs, inline
                  comments, and merge actions directly inside the client.
                </T>
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPaneView("triage")}>
                  <T>Back to Triage</T>
                </Button>
                <Button
                  render={
                    <a href={changeRequest.url} rel="noreferrer" target="_blank">
                      <ExternalLinkIcon />
                      <T>Open on GitHub</T>
                    </a>
                  }
                  size="sm"
                  variant="default"
                />
              </div>
            </EmptyContent>
          </Empty>
        )
      ) : (
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            <h2 className="text-base leading-snug font-semibold text-foreground">
              {changeRequest.title}
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">@{changeRequest.authorVcsLogin}</span>
              <span className="inline-flex min-w-0 items-center gap-1 font-mono text-2xs">
                <GitBranchIcon className="size-3 shrink-0" />
                <span className="truncate">
                  {changeRequest.headBranch} → {changeRequest.baseBranch}
                </span>
              </span>
              <CockpitDiffStat
                additions={changeRequest.additions}
                deletions={changeRequest.deletions}
              />
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 text-2xs",
                  ciTone === "error"
                    ? "text-destructive"
                    : ciTone === "success"
                      ? "text-success-foreground"
                      : "text-muted-foreground",
                )}
              >
                <CockpitStatusDot tone={ciTone} />
                <T>
                  CI: <Var>{ciStatusLabel(changeRequest.qualitySignals.ciStatus, gt)}</Var>
                </T>
              </span>
              <Badge
                size="sm"
                variant={
                  changeRequest.humanReviewState === "approved"
                    ? "success"
                    : changeRequest.humanReviewState === "changes_requested"
                      ? "error"
                      : "secondary"
                }
              >
                {humanReviewLabel(changeRequest.humanReviewState, gt)}
              </Badge>
              {changeRequest.isOversized ? (
                <Badge size="sm" variant="warning">
                  <AlertTriangleIcon />
                  <T>Oversized</T>
                </Badge>
              ) : null}
            </div>
          </div>

          <CockpitSurface className="space-y-3" padding="md" variant="subtle">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                <BotIcon className="size-3.5 text-muted-foreground" />
                <T>Handle Directly in U3 Code</T>
              </div>
              {localProjects.length > 0 && selectedLocalProject ? (
                <div className="w-44 shrink-0">
                  <Select
                    value={`${selectedLocalProject.environmentId}:${selectedLocalProject.id}`}
                    onValueChange={(val) => {
                      if (val) {
                        setChosenLocalProjectByRepo((prev) => ({
                          ...prev,
                          [changeRequest.repoFullName]: val,
                        }));
                      }
                    }}
                  >
                    <SelectTrigger size="compact">
                      <SelectValue>{selectedLocalProject.title}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {localProjects.map((proj) => (
                        <SelectItem
                          key={`${proj.environmentId}:${proj.id}`}
                          value={`${proj.environmentId}:${proj.id}`}
                        >
                          {proj.title}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hasBlockers ? (
                <Button
                  disabled={startingAgent !== null || !selectedLocalProject}
                  size="sm"
                  variant="default"
                  onClick={() => void handleLaunchAgentThread("fix")}
                >
                  <WrenchIcon />
                  {startingAgent === "fix" ? (
                    <T>Starting Fix Thread...</T>
                  ) : (
                    <T>Fix Findings with Agent</T>
                  )}
                </Button>
              ) : (
                <Button
                  disabled={startingAgent !== null || !selectedLocalProject}
                  size="sm"
                  variant="default"
                  onClick={() => void handleLaunchAgentThread("review")}
                >
                  <MessageSquareCodeIcon />
                  {startingAgent === "review" ? (
                    <T>Starting Review Thread...</T>
                  ) : (
                    <T>Review PR with Agent</T>
                  )}
                </Button>
              )}

              {hasBlockers ? (
                <Button
                  disabled={startingAgent !== null || !selectedLocalProject}
                  size="sm"
                  variant="outline"
                  onClick={() => void handleLaunchAgentThread("review")}
                >
                  <MessageSquareCodeIcon />
                  <T>Review with Agent</T>
                </Button>
              ) : null}

              <Button size="sm" variant="outline" onClick={() => setPaneView("native")}>
                <PullRequestGlyph.pullRequest />
                <T>Open Native Diff & Actions</T>
              </Button>
            </div>

            {!selectedLocalProject ? (
              <p className="text-xs text-muted-foreground">
                <T>
                  Add this repository as a local project in the sidebar to launch Agent fix/review
                  threads or inspect native diffs here.
                </T>
              </p>
            ) : null}
          </CockpitSurface>

          <section className="space-y-2">
            <CockpitSectionHeader
              count={changeRequest.automatedReview.reviewers.length}
              icon={<BotIcon />}
              title={<T>Automated Review Signals</T>}
            />

            {changeRequest.automatedReview.reviewers.length === 0 ? (
              <CockpitSurface padding="sm" variant="grouped">
                <p className="text-xs text-muted-foreground">
                  <T>No automated bot findings recorded on this PR.</T>
                </p>
              </CockpitSurface>
            ) : (
              <CockpitSurface divided variant="grouped">
                {changeRequest.automatedReview.reviewers.map((finding) => (
                  <CockpitSurfaceRow
                    key={`${finding.reviewerName}:${finding.updatedAt}:${finding.state}`}
                    className="space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {finding.reviewerName}
                        </span>
                        {finding.riskLevel && finding.riskLevel !== "unknown" ? (
                          <Badge
                            size="sm"
                            variant={
                              finding.riskLevel === "high"
                                ? "error"
                                : finding.riskLevel === "medium"
                                  ? "warning"
                                  : "secondary"
                            }
                          >
                            {riskLevelLabel(finding.riskLevel, gt)}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge
                          size="sm"
                          variant={
                            finding.state === "changes_requested"
                              ? "error"
                              : finding.state === "approved"
                                ? "success"
                                : "secondary"
                          }
                        >
                          {reviewerStateLabel(finding.state, gt)}
                        </Badge>
                        {finding.url ? (
                          <Button
                            aria-label={gt("Open review finding")}
                            render={
                              <a href={finding.url} rel="noreferrer" target="_blank">
                                <ExternalLinkIcon />
                              </a>
                            }
                            size="icon-micro"
                            variant="ghost-muted"
                          />
                        ) : null}
                      </div>
                    </div>
                    {finding.bodyExcerpt ? (
                      <p className="leading-relaxed text-muted-foreground">{finding.bodyExcerpt}</p>
                    ) : null}
                  </CockpitSurfaceRow>
                ))}
              </CockpitSurface>
            )}
          </section>

          {qualitySignals.length > 0 ? (
            <section className="space-y-2">
              <CockpitSectionHeader
                count={qualitySignals.length}
                icon={<ShieldCheckIcon />}
                title={<T>Quality Signals</T>}
              />
              <CockpitSurface divided variant="grouped">
                {qualitySignals.map((signal) => (
                  <CockpitSurfaceRow
                    key={signal.key}
                    className="flex items-center justify-between gap-2 text-xs"
                    density="compact"
                  >
                    <span className="min-w-0 truncate text-foreground">
                      {signal.label ?? signal.key}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {signal.value !== null ? (
                        <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                          {signal.value}
                          {signal.unit ?? ""}
                        </span>
                      ) : signal.rawSummary ? (
                        <span className="truncate text-2xs text-muted-foreground">
                          {signal.rawSummary}
                        </span>
                      ) : null}
                      <CockpitStatusDot
                        tone={
                          signal.passed === true
                            ? "success"
                            : signal.passed === false
                              ? "error"
                              : "neutral"
                        }
                      />
                    </div>
                  </CockpitSurfaceRow>
                ))}
              </CockpitSurface>
            </section>
          ) : null}

          <Separator />

          <section className="space-y-2">
            <CockpitSectionHeader icon={<Link2Icon />} title={<T>Linked Work Item</T>} />

            {linkedCard ? (
              <CockpitSurface
                className="flex items-center justify-between gap-3"
                padding="sm"
                variant="card"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <CockpitPriorityDot priority={linkedCard.workItem.priority} />
                    <span className="font-mono text-xs font-medium text-muted-foreground">
                      {linkedCard.workItem.code}
                    </span>
                    <Badge size="sm" variant="outline">
                      {linkedCard.workItem.stage}
                    </Badge>
                  </div>
                  <p className="truncate text-sm font-medium text-foreground">
                    {linkedCard.workItem.title}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onOpenWorkItem(linkedCard.workItem.id)}
                  >
                    <T>Open Item</T>
                  </Button>
                  <Button
                    aria-label={gt("Unlink work item")}
                    size="icon-xs"
                    variant="ghost-muted"
                    onClick={() => onLinkChangeRequest(changeRequest.id, null)}
                  >
                    <UnlinkIcon />
                  </Button>
                </div>
              </CockpitSurface>
            ) : cards.length > 0 ? (
              <CockpitSurface
                className="flex flex-wrap items-center gap-2"
                padding="sm"
                variant="grouped"
              >
                <div className="min-w-44 flex-1">
                  <Select
                    value={effectiveLinkTargetId}
                    onValueChange={(val) => {
                      if (val) setSelectedWorkItemId(val);
                    }}
                  >
                    <SelectTrigger size="compact">
                      <SelectValue>
                        {(() => {
                          const target = cards.find((c) => c.workItem.id === effectiveLinkTargetId);
                          return target
                            ? `${target.workItem.code} · ${target.workItem.title}`
                            : gt("Select work item...");
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {cards.map((card) => (
                        <SelectItem key={card.workItem.id} value={card.workItem.id}>
                          {card.workItem.code} · {card.workItem.title}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <Button
                  disabled={!effectiveLinkTargetId}
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    if (effectiveLinkTargetId) {
                      onLinkChangeRequest(changeRequest.id, effectiveLinkTargetId);
                    }
                  }}
                >
                  <Link2Icon />
                  <T>Link Work Item</T>
                </Button>
              </CockpitSurface>
            ) : (
              <p className="text-xs text-muted-foreground">
                <T>No work items in this project yet to link.</T>
              </p>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
