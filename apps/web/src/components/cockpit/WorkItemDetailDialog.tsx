import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, WorkItemDetail } from "@t3tools/contracts";
import {
  buildLifecycleAttributesPatch,
  deriveWorkItemPipelinePhase,
  readWorkItemLifecycle,
  resolveLatestGateApprovals,
  standardGitHubLabels,
  suggestWorkItemBranchName,
  type ArtifactStatus,
  type AssigneeType,
  type BranchTopology,
  type ChangeRequestAudit,
  type ChecklistItem,
  type DesignTier,
  type Project,
  type ProjectMemory,
  type ProjectRepo,
  type WorkHealth,
  type WorkItem,
  type WorkItemType,
  type WorkspaceMember,
} from "@u3code/hub-contracts";
import { T, useGT, useLocale, Var } from "gt-react";
import {
  ActivityIcon,
  ArrowRightIcon,
  BotIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  PencilIcon,
  PlusIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  CockpitArtifactIcon,
  CockpitStageArtworkIcon,
  CockpitStudioBanner,
  type CockpitArtifactArtKind,
  type CockpitStageArtKind,
} from "./CockpitArtwork";
import {
  CockpitDiffStat,
  CockpitFieldLabel,
  CockpitHealthDot,
  CockpitIconBadge,
  CockpitInlineAlert,
  CockpitPriorityDot,
  CockpitSectionHeader,
  CockpitStatusDot,
  CockpitSurface,
  CockpitSurfaceRow,
  type CockpitIconBadgeTone,
  type CockpitTone,
} from "./CockpitPrimitives";
import { CockpitSwarmAvatar, type CockpitTeamMember } from "./CockpitSwarmAvatar";
import { formatCockpitCommandError } from "./cockpitError";
import {
  buildIssueDispatchPrompt,
  buildPrdGenerationPrompt,
  buildPrototypeGenerationPrompt,
  buildWorkItemThreadPrompt,
  pickMatchingWorkspaceProject,
} from "./workItemPrompt";

interface WorkItemDetailDialogProps {
  readonly environmentId: EnvironmentId;
  readonly workItemId: string | null;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly repos?: ReadonlyArray<ProjectRepo> | undefined;
  readonly members?: ReadonlyArray<WorkspaceMember> | undefined;
  readonly roster?: ReadonlyArray<CockpitTeamMember> | undefined;
  readonly stages: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly gates: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly beforeStage: string;
    readonly optional?: boolean | undefined;
  }>;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
  readonly onOpenChangeRequest?: (cr: ChangeRequestAudit) => void;
  readonly onOpenPromptSettings?: () => void;
}

type PipelineActionKind = "prd" | "prototype" | "issue" | "dev";

type SpecViewMode = "edit" | "preview";

type SpecMarkdownBlock =
  | {
      readonly kind: "heading";
      readonly level: 1 | 2 | 3;
      readonly text: string;
      readonly startLine: number;
    }
  | { readonly kind: "hr"; readonly startLine: number }
  | { readonly kind: "code"; readonly code: string; readonly startLine: number }
  | {
      readonly kind: "quote";
      readonly lines: ReadonlyArray<{ readonly text: string; readonly line: number }>;
      readonly startLine: number;
    }
  | {
      readonly kind: "ul";
      readonly items: ReadonlyArray<{
        readonly text: string;
        readonly checked: boolean | null;
        readonly line: number;
      }>;
      readonly startLine: number;
    }
  | {
      readonly kind: "ol";
      readonly items: ReadonlyArray<{ readonly text: string; readonly line: number }>;
      readonly startLine: number;
    }
  | { readonly kind: "paragraph"; readonly text: string; readonly startLine: number };

const DEFAULT_AGENT_RUNNER_ID = "claude-agent";

const GUIDED_BAR_TONE_CLASS: Record<CockpitIconBadgeTone, string> = {
  error: "border-destructive/30 bg-linear-to-r from-destructive/10 via-card/85 to-card/55",
  info: "border-info/30 bg-linear-to-r from-info/10 via-card/85 to-card/55",
  violet: "border-guest/30 bg-linear-to-r from-guest/10 via-card/85 to-card/55",
  warning: "border-warning/30 bg-linear-to-r from-warning/10 via-card/85 to-card/55",
  primary: "border-primary/28 bg-linear-to-r from-primary/10 via-card/85 to-card/55",
  success: "border-success/30 bg-linear-to-r from-success/10 via-card/85 to-card/55",
  neutral: "border-border/60 bg-linear-to-r from-muted/40 via-card/85 to-card/55",
};

const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const HR_PATTERN = /^(?:---+|___+|\*\*\*+)$/;
const UNORDERED_ITEM_PATTERN = /^\s*[-*+]\s+(.*)$/;
const CHECKBOX_ITEM_PATTERN = /^\[( |x|X)\]\s+(.*)$/;
const ORDERED_ITEM_PATTERN = /^\s*\d+[.)]\s+(.*)$/;
const INLINE_TOKEN_PATTERN = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;

function isBlockStarter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("```")) return true;
  if (HR_PATTERN.test(trimmed)) return true;
  if (HEADING_PATTERN.test(trimmed)) return true;
  if (trimmed.startsWith(">")) return true;
  if (UNORDERED_ITEM_PATTERN.test(line)) return true;
  if (ORDERED_ITEM_PATTERN.test(line)) return true;
  return false;
}

function parseSpecMarkdownBlocks(markdown: string): ReadonlyArray<SpecMarkdownBlock> {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: SpecMarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const startLine = i;
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      blocks.push({ kind: "code", code: codeLines.join("\n"), startLine });
      continue;
    }

    if (HR_PATTERN.test(trimmed)) {
      blocks.push({ kind: "hr", startLine: i });
      i += 1;
      continue;
    }

    const headingMatch = HEADING_PATTERN.exec(trimmed);
    if (headingMatch) {
      const depth = headingMatch[1]?.length ?? 1;
      const level: 1 | 2 | 3 = depth <= 1 ? 1 : depth === 2 ? 2 : 3;
      blocks.push({ kind: "heading", level, text: (headingMatch[2] ?? "").trim(), startLine: i });
      i += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const startLine = i;
      const quoteLines: Array<{ readonly text: string; readonly line: number }> = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        quoteLines.push({
          text: (lines[i] ?? "").trim().replace(/^>\s?/, ""),
          line: i,
        });
        i += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines, startLine });
      continue;
    }

    if (UNORDERED_ITEM_PATTERN.test(line)) {
      const startLine = i;
      const items: Array<{
        readonly text: string;
        readonly checked: boolean | null;
        readonly line: number;
      }> = [];
      while (i < lines.length) {
        const match = UNORDERED_ITEM_PATTERN.exec(lines[i] ?? "");
        if (!match) break;
        const rawItem = (match[1] ?? "").trim();
        const checkboxMatch = CHECKBOX_ITEM_PATTERN.exec(rawItem);
        if (checkboxMatch) {
          items.push({
            text: (checkboxMatch[2] ?? "").trim(),
            checked: (checkboxMatch[1] ?? "").toLowerCase() === "x",
            line: i,
          });
        } else {
          items.push({ text: rawItem, checked: null, line: i });
        }
        i += 1;
      }
      blocks.push({ kind: "ul", items, startLine });
      continue;
    }

    if (ORDERED_ITEM_PATTERN.test(line)) {
      const startLine = i;
      const items: Array<{ readonly text: string; readonly line: number }> = [];
      while (i < lines.length) {
        const match = ORDERED_ITEM_PATTERN.exec(lines[i] ?? "");
        if (!match) break;
        items.push({ text: (match[1] ?? "").trim(), line: i });
        i += 1;
      }
      blocks.push({ kind: "ol", items, startLine });
      continue;
    }

    const startLine = i;
    const paraLines: string[] = [line];
    i += 1;
    while (i < lines.length && !isBlockStarter(lines[i] ?? "")) {
      paraLines.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: paraLines.join("\n"), startLine });
  }

  return blocks;
}

function renderInlineSpecText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(INLINE_TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      nodes.push(text.slice(cursor, start));
    }
    const raw = match[0];
    const key = `${keyPrefix}-${tokenIndex}`;
    tokenIndex += 1;

    if (raw.startsWith("`") && raw.endsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded border border-border/50 bg-muted/50 px-1 py-0.5 font-mono text-2xs text-foreground"
        >
          {raw.slice(1, -1)}
        </code>,
      );
    } else if (raw.startsWith("**") && raw.endsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {raw.slice(2, -2)}
        </strong>,
      );
    } else if (raw.startsWith("*") && raw.endsWith("*")) {
      nodes.push(
        <em key={key} className="italic text-foreground/90">
          {raw.slice(1, -1)}
        </em>,
      );
    } else {
      nodes.push(raw);
    }

    cursor = start + raw.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function SpecMarkdownPreview({
  markdown,
  onSwitchToEdit,
}: {
  readonly markdown: string;
  readonly onSwitchToEdit: () => void;
}) {
  const trimmed = markdown.trim();
  if (!trimmed) {
    return (
      <CockpitSurface
        className="flex flex-col items-start justify-between gap-2.5 sm:flex-row sm:items-center"
        id="wid-spec"
        padding="md"
        tabIndex={-1}
        variant="subtle"
      >
        <p className="text-xs leading-relaxed text-muted-foreground">
          <T>
            No specification written yet. Switch to Edit or launch AI Draft PRD to generate a
            structured spec.
          </T>
        </p>
        <Button size="xs" variant="outline" onClick={onSwitchToEdit}>
          <PencilIcon />
          <T>Write Specification</T>
        </Button>
      </CockpitSurface>
    );
  }

  const blocks = parseSpecMarkdownBlocks(trimmed);

  return (
    <CockpitSurface
      className="max-h-72 space-y-2.5 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      id="wid-spec"
      padding="md"
      tabIndex={-1}
      variant="grouped"
    >
      {blocks.map((block) => {
        const blockKey = `spec-block-${block.startLine}`;
        switch (block.kind) {
          case "heading":
            if (block.level === 1) {
              return (
                <h3
                  key={blockKey}
                  className="border-b border-border/45 pb-1 text-sm font-semibold tracking-tight text-foreground"
                >
                  {renderInlineSpecText(block.text, blockKey)}
                </h3>
              );
            }
            if (block.level === 2) {
              return (
                <h4
                  key={blockKey}
                  className="pt-1 text-xs font-semibold tracking-tight text-foreground"
                >
                  {renderInlineSpecText(block.text, blockKey)}
                </h4>
              );
            }
            return (
              <h5 key={blockKey} className="pt-0.5 text-xs font-medium text-foreground/90">
                {renderInlineSpecText(block.text, blockKey)}
              </h5>
            );
          case "hr":
            return <hr key={blockKey} className="border-border/50" />;
          case "code":
            return (
              <pre
                key={blockKey}
                className="overflow-x-auto rounded-lg border border-border/55 bg-muted/40 p-2.5 font-mono text-2xs leading-relaxed text-foreground"
              >
                <code>{block.code}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote
                key={blockKey}
                className="space-y-1 border-l-2 border-primary/40 pl-3 text-xs leading-relaxed text-muted-foreground"
              >
                {block.lines.map((quoteLine) => {
                  const quoteKey = `${blockKey}-q-${quoteLine.line}`;
                  return (
                    <p key={quoteKey} className="whitespace-pre-wrap">
                      {renderInlineSpecText(quoteLine.text, quoteKey)}
                    </p>
                  );
                })}
              </blockquote>
            );
          case "ul":
            return (
              <ul key={blockKey} className="space-y-1 text-xs leading-relaxed text-foreground/90">
                {block.items.map((item) => {
                  const itemKey = `${blockKey}-li-${item.line}`;
                  return (
                    <li key={itemKey} className="flex items-start gap-2">
                      {item.checked !== null ? (
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                            item.checked
                              ? "border-success/45 bg-success/15 text-success-foreground"
                              : "border-border bg-muted/40 text-transparent",
                          )}
                        >
                          <CheckIcon className="size-2.5" />
                        </span>
                      ) : (
                        <span
                          aria-hidden
                          className="mt-1.5 inline-block size-1 shrink-0 rounded-full bg-muted-foreground/70"
                        />
                      )}
                      <span
                        className={cn(
                          "min-w-0 flex-1 whitespace-pre-wrap",
                          item.checked ? "text-muted-foreground line-through" : undefined,
                        )}
                      >
                        {renderInlineSpecText(item.text, itemKey)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            );
          case "ol":
            return (
              <ol
                key={blockKey}
                className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-foreground/90"
              >
                {block.items.map((item) => {
                  const itemKey = `${blockKey}-oli-${item.line}`;
                  return (
                    <li key={itemKey} className="whitespace-pre-wrap pl-0.5">
                      {renderInlineSpecText(item.text, itemKey)}
                    </li>
                  );
                })}
              </ol>
            );
          case "paragraph":
            return (
              <p
                key={blockKey}
                className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90"
              >
                {renderInlineSpecText(block.text, blockKey)}
              </p>
            );
        }
      })}
    </CockpitSurface>
  );
}

function workHealthLabel(health: WorkHealth, gt: ReturnType<typeof useGT>): string {
  switch (health) {
    case "on_track":
      return gt("On track");
    case "at_risk":
      return gt("At risk");
    case "blocked":
      return gt("Blocked");
  }
}

function reviewStatusLabel(status: string, gt: ReturnType<typeof useGT>): string {
  switch (status) {
    case "blocking":
      return gt("Blocking");
    case "pass":
      return gt("Passed");
    case "auto_merged":
      return gt("Auto-merged");
    case "pending":
      return gt("Pending");
    case "none":
      return gt("None");
    default:
      return status;
  }
}

function designTierLabel(tier: DesignTier, gt: ReturnType<typeof useGT>): string {
  switch (tier) {
    case "small":
      return gt("Small");
    case "medium":
      return gt("Medium");
    case "large":
      return gt("Large");
    case "cross_repo":
      return gt("Cross-repo");
  }
}

function artifactStatusLabel(status: ArtifactStatus, gt: ReturnType<typeof useGT>): string {
  switch (status) {
    case "none":
      return gt("None");
    case "draft":
      return gt("Draft");
    case "approved":
      return gt("Approved");
  }
}

function workItemTypeArtKind(itemType: WorkItemType): CockpitArtifactArtKind {
  switch (itemType) {
    case "feature":
      return "feature";
    case "bug":
      return "bug";
    case "refactor":
      return "refactor";
    case "chore":
      return "chore";
    case "security":
      return "security";
  }
}

function workItemTypeBadgeTone(itemType: WorkItemType): CockpitIconBadgeTone {
  switch (itemType) {
    case "feature":
      return "primary";
    case "bug":
      return "error";
    case "refactor":
      return "violet";
    case "chore":
      return "neutral";
    case "security":
      return "warning";
  }
}

function gitHubLabelBadgeVariant(
  label: string,
): "error" | "warning" | "info" | "secondary" | "outline" {
  const normalized = label.toLowerCase();
  if (normalized === "priority:p0" || normalized === "type:bug") return "error";
  if (normalized === "priority:p1" || normalized === "type:security") return "warning";
  if (normalized === "type:feature" || normalized === "priority:p2") return "info";
  if (normalized === "type:refactor") return "secondary";
  return "outline";
}

function encodeAssigneeValue(
  assigneeType: AssigneeType,
  assigneeUserId: string | null,
  assigneeRunnerId: string | null,
): string {
  if (assigneeType === "human" && assigneeUserId) {
    return `human:${assigneeUserId}`;
  }
  if (assigneeType === "runner" && assigneeRunnerId) {
    return `runner:${assigneeRunnerId}`;
  }
  return "unassigned";
}

function decodeAssigneeValue(value: string): {
  readonly assigneeType: AssigneeType;
  readonly assigneeUserId: string | null;
  readonly assigneeRunnerId: string | null;
} {
  if (value.startsWith("human:")) {
    const userId = value.slice("human:".length).trim();
    if (userId) {
      return { assigneeType: "human", assigneeUserId: userId, assigneeRunnerId: null };
    }
  }
  if (value.startsWith("runner:")) {
    const runnerId = value.slice("runner:".length).trim();
    if (runnerId) {
      return { assigneeType: "runner", assigneeUserId: null, assigneeRunnerId: runnerId };
    }
  }
  return { assigneeType: "unassigned", assigneeUserId: null, assigneeRunnerId: null };
}

function resolveMemberHandle(
  member: WorkspaceMember,
  roster: ReadonlyArray<CockpitTeamMember>,
): string {
  const fromRoster = roster.find((entry) => entry.id === member.userId);
  if (fromRoster) return fromRoster.handle;
  const vcs = member.primaryVcsLogin?.trim();
  if (vcs) return vcs.replace(/^@+/, "").toLowerCase();
  const emailLocal = member.email?.split("@")[0]?.trim();
  if (emailLocal) return emailLocal.toLowerCase();
  return member.displayName.trim().toLowerCase().replace(/\s+/g, "-") || member.userId;
}

function isSafeExternalUrl(raw: string): boolean {
  return /^https?:\/\/\S+$/i.test(raw.trim());
}

function parseGitHubIssueInput(
  raw: string,
  primaryRepoFullName: string | null,
): { readonly number: number | null; readonly url: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { number: null, url: null };

  const urlIssueMatch = trimmed.match(/^https?:\/\/.+\/issues\/(\d+)(?:[/?#].*)?$/i);
  if (urlIssueMatch) {
    return { number: Number(urlIssueMatch[1]), url: trimmed };
  }

  if (isSafeExternalUrl(trimmed)) {
    return { number: null, url: trimmed };
  }

  const numMatch = trimmed.match(/^#?(\d+)$/);
  if (numMatch) {
    const num = Number(numMatch[1]);
    const derivedUrl = primaryRepoFullName
      ? `https://github.com/${primaryRepoFullName}/issues/${num}`
      : null;
    return { number: num, url: derivedUrl };
  }

  return { number: null, url: null };
}

function buildBranchCheckoutCommand(
  branchName: string,
  topology: BranchTopology,
  workItem?: Pick<WorkItem, "priority" | "itemType"> | null,
): string {
  const isHotfix =
    workItem?.priority === "p0" &&
    (workItem.itemType === "bug" || workItem.itemType === "security");
  const baseBranch = topology === "single_trunk" || isHotfix ? "main" : "dev";
  return `git fetch origin ${baseBranch} && git switch --no-track -c ${branchName} "$(git rev-parse --verify 'FETCH_HEAD^{commit}')"`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}

function focusElementById(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (el instanceof HTMLElement) {
    el.focus();
  }
}

export function WorkItemDetailDialog({
  environmentId,
  workItemId,
  project,
  memory,
  repos = [],
  members = [],
  roster = [],
  stages,
  gates,
  onClose,
  onUpdated,
  onOpenChangeRequest,
  onOpenPromptSettings,
}: WorkItemDetailDialogProps) {
  const gt = useGT();
  const locale = useLocale();
  const localProjects = useProjects();
  const handleNewThread = useNewThreadHandler();

  const [detail, setDetail] = useState<WorkItemDetail | null>(null);
  const [loadedWorkItemId, setLoadedWorkItemId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("");
  const [health, setHealth] = useState<WorkHealth>("on_track");
  const [assigneeValue, setAssigneeValue] = useState<string>("unassigned");
  const [plannedStartAt, setPlannedStartAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [designTier, setDesignTier] = useState<DesignTier>("medium");
  const [prdStatus, setPrdStatus] = useState<ArtifactStatus>("none");
  const [prototypeStatus, setPrototypeStatus] = useState<ArtifactStatus>("none");
  const [prototypeUrl, setPrototypeUrl] = useState("");
  const [initialPrototypeUrl, setInitialPrototypeUrl] = useState("");
  const [githubIssueInput, setGithubIssueInput] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchTopology, setBranchTopology] = useState<BranchTopology>("dual_trunk");
  const [specMarkdown, setSpecMarkdown] = useState("");
  const [specMode, setSpecMode] = useState<SpecViewMode>("edit");
  const [checklistItems, setChecklistItems] = useState<ReadonlyArray<ChecklistItem>>([]);
  const [newAcText, setNewAcText] = useState("");
  const [saving, setSaving] = useState(false);
  const [advancingStage, setAdvancingStage] = useState(false);

  const [busyGateKey, setBusyGateKey] = useState<string | null>(null);
  const [rejectingGateKey, setRejectingGateKey] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [unlinkingCrId, setUnlinkingCrId] = useState<string | null>(null);

  const [chosenLocalProjectId, setChosenLocalProjectId] = useState<string>("");
  const [launchingAction, setLaunchingAction] = useState<PipelineActionKind | null>(null);

  const getDetail = useAtomCommand(teamHubEnvironment.getWorkItemDetail, { reportFailure: false });
  const updateWorkItem = useAtomCommand(teamHubEnvironment.updateWorkItem, {
    reportFailure: false,
  });
  const approveGate = useAtomCommand(teamHubEnvironment.approveGate, { reportFailure: false });
  const linkChangeRequest = useAtomCommand(teamHubEnvironment.linkChangeRequest, {
    reportFailure: false,
  });

  const hydrateFromDetail = (data: WorkItemDetail) => {
    const lifecycle = readWorkItemLifecycle(data.workItem);
    const hydratedProtoUrl = lifecycle.prototypeUrl ?? data.workItem.previewUrls[0] ?? "";
    const hydratedIssue =
      lifecycle.githubIssueUrl ??
      (lifecycle.githubIssueNumber !== null ? `#${lifecycle.githubIssueNumber}` : "");

    setDetail(data);
    setTitle(data.workItem.title);
    setStage(data.workItem.stage);
    setHealth(data.workItem.health);
    setAssigneeValue(
      encodeAssigneeValue(
        data.workItem.assigneeType,
        data.workItem.assigneeUserId,
        data.workItem.assigneeRunnerId,
      ),
    );
    setPlannedStartAt(lifecycle.plannedStartAt ? lifecycle.plannedStartAt.slice(0, 10) : "");
    setDueAt(lifecycle.dueAt ? lifecycle.dueAt.slice(0, 10) : "");
    setDesignTier(lifecycle.designTier);
    setPrdStatus(lifecycle.prdStatus);
    setPrototypeStatus(lifecycle.prototypeStatus);
    setPrototypeUrl(hydratedProtoUrl);
    setInitialPrototypeUrl(hydratedProtoUrl);
    setGithubIssueInput(hydratedIssue);
    setBranchName(lifecycle.branchName ?? "");
    setBranchTopology(lifecycle.branchTopology);
    setSpecMarkdown(data.workItem.specMarkdown);
    setChecklistItems(data.workItem.checklistItems);
  };

  const fetchDetail = useEffectEvent(
    (envId: EnvironmentId, id: string, cancelled: () => boolean) => {
      void getDetail({ environmentId: envId, input: { workItemId: id } }).then((res) => {
        if (cancelled()) return;
        setLoadedWorkItemId(id);
        if (res._tag === "Success") {
          setLoadError(null);
          hydrateFromDetail(res.value);
        } else {
          setLoadError(formatCockpitCommandError(res, gt("Failed to load work item details.")));
        }
      });
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch full WorkItem detail (spec, checklist, linked PRs, and pulse timeline) from Team Hub when dialog opens.
  useEffect(() => {
    if (!workItemId) return;
    let cancelled = false;
    fetchDetail(environmentId, workItemId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [environmentId, workItemId]);

  const loading = workItemId !== null && loadedWorkItemId !== workItemId;
  const activeDetail = workItemId !== null && detail?.workItem.id === workItemId ? detail : null;

  const matchedProject = pickMatchingWorkspaceProject(localProjects, repos, project);
  const selectedLocalProject =
    localProjects.find((p) => `${p.environmentId}:${p.id}` === chosenLocalProjectId) ??
    matchedProject;
  const matchedRepoForSelectedLocal = selectedLocalProject
    ? (repos.find((repo) => {
        const repoLeaf = repo.repoFullName.split("/").at(-1)?.trim().toLowerCase() ?? "";
        const folderName =
          selectedLocalProject.workspaceRoot.split(/[\\/]/).at(-1)?.trim().toLowerCase() ?? "";
        return (
          repoLeaf.length > 0 &&
          (repoLeaf === selectedLocalProject.title.trim().toLowerCase() || repoLeaf === folderName)
        );
      }) ?? null)
    : null;
  const primaryRepoFullName =
    matchedRepoForSelectedLocal?.repoFullName ?? repos[0]?.repoFullName ?? null;

  const selectedStageLabel = stages.find((s) => s.id === stage)?.label ?? stage;
  const currentStageIndex = stages.findIndex((s) => s.id === stage);
  const nextStage =
    currentStageIndex >= 0 && currentStageIndex < stages.length - 1
      ? (stages[currentStageIndex + 1] ?? null)
      : null;

  const verifiedCount = checklistItems.filter((item) => item.verified).length;
  const acPercent =
    checklistItems.length > 0 ? Math.round((verifiedCount / checklistItems.length) * 100) : 0;
  const allAcVerified = checklistItems.length > 0 && verifiedCount === checklistItems.length;

  const decodedAssignee = decodeAssigneeValue(assigneeValue);
  const parsedIssue = parseGitHubIssueInput(githubIssueInput, primaryRepoFullName);

  const memberOptions = members.map((member) => ({
    value: `human:${member.userId}`,
    userId: member.userId,
    handle: resolveMemberHandle(member, roster),
    displayName: member.displayName,
  }));

  const selectedMemberOption =
    decodedAssignee.assigneeType === "human" && decodedAssignee.assigneeUserId
      ? (memberOptions.find((entry) => entry.userId === decodedAssignee.assigneeUserId) ?? null)
      : null;

  const selectedRosterMember =
    decodedAssignee.assigneeType === "human" && decodedAssignee.assigneeUserId
      ? (roster.find((entry) => entry.id === decodedAssignee.assigneeUserId) ?? null)
      : decodedAssignee.assigneeType === "runner" && decodedAssignee.assigneeRunnerId
        ? (roster.find((entry) => entry.handle === decodedAssignee.assigneeRunnerId) ?? null)
        : null;

  const resolvedAssigneeHandle =
    decodedAssignee.assigneeType === "human"
      ? (selectedMemberOption?.handle ?? selectedRosterMember?.handle ?? null)
      : decodedAssignee.assigneeType === "runner"
        ? (decodedAssignee.assigneeRunnerId ?? DEFAULT_AGENT_RUNNER_ID)
        : null;

  const resolvedAssigneeDisplayName =
    decodedAssignee.assigneeType === "human"
      ? (selectedMemberOption?.displayName ?? selectedRosterMember?.displayName ?? null)
      : decodedAssignee.assigneeType === "runner"
        ? gt("Coding Agent")
        : null;

  const customHumanAssigneeFallback =
    decodedAssignee.assigneeType === "human" &&
    decodedAssignee.assigneeUserId &&
    !selectedMemberOption
      ? {
          value: assigneeValue,
          label: selectedRosterMember
            ? `@${selectedRosterMember.handle}`
            : decodedAssignee.assigneeUserId,
        }
      : null;

  const customRunnerAssigneeFallback =
    decodedAssignee.assigneeType === "runner" &&
    decodedAssignee.assigneeRunnerId &&
    decodedAssignee.assigneeRunnerId !== DEFAULT_AGENT_RUNNER_ID
      ? {
          value: assigneeValue,
          runnerId: decodedAssignee.assigneeRunnerId,
        }
      : null;

  const activeLifecycle = activeDetail ? readWorkItemLifecycle(activeDetail.workItem) : null;
  const standardLabels = activeDetail
    ? activeLifecycle && activeLifecycle.githubLabels.length > 0
      ? activeLifecycle.githubLabels
      : standardGitHubLabels(activeDetail.workItem.itemType, activeDetail.workItem.priority)
    : [];

  const suggestedBranch = activeDetail
    ? suggestWorkItemBranchName({
        itemType: activeDetail.workItem.itemType,
        priority: activeDetail.workItem.priority,
        code: activeDetail.workItem.code,
        title: title.trim() || activeDetail.workItem.title,
        githubIssueNumber: parsedIssue.number,
      })
    : "";
  const effectiveBranchName = branchName.trim() || suggestedBranch;

  const buildNextPreviewUrls = (basePreviewUrls: ReadonlyArray<string>): string[] => {
    const trimmedProtoUrl = prototypeUrl.trim();
    const preserved = basePreviewUrls.filter(
      (url) => url !== initialPrototypeUrl && url !== trimmedProtoUrl,
    );
    return trimmedProtoUrl ? [trimmedProtoUrl, ...preserved] : preserved;
  };

  const buildLifecyclePatch = (): Record<string, unknown> =>
    buildLifecycleAttributesPatch({
      plannedStartAt: plannedStartAt.trim() || null,
      dueAt: dueAt.trim() || null,
      designTier,
      prdStatus,
      prototypeStatus,
      prototypeUrl: prototypeUrl.trim() || null,
      githubIssueNumber: parsedIssue.number,
      githubIssueUrl: parsedIssue.url,
      githubLabels: standardLabels,
      branchTopology,
      branchName: branchName.trim() || null,
    });

  const draftWorkItem: WorkItem | null = activeDetail
    ? {
        ...activeDetail.workItem,
        title: title.trim() || activeDetail.workItem.title,
        stage,
        health,
        assigneeType: decodedAssignee.assigneeType,
        assigneeUserId: decodedAssignee.assigneeUserId,
        assigneeRunnerId: decodedAssignee.assigneeRunnerId,
        specMarkdown,
        previewUrls: buildNextPreviewUrls(activeDetail.workItem.previewUrls),
        checklistItems: [...checklistItems],
        attributes: {
          ...activeDetail.workItem.attributes,
          ...buildLifecyclePatch(),
        },
      }
    : null;

  const currentPhase =
    draftWorkItem && activeDetail
      ? deriveWorkItemPipelinePhase({
          workItem: draftWorkItem,
          changeRequests: activeDetail.changeRequests,
        })
      : "intake";

  const isDoneStage = currentPhase === "done";
  const hasPrdArtifact = prdStatus !== "none" || specMarkdown.trim().length > 40;
  const hasPrototypeArtifact =
    prototypeStatus !== "none" ||
    prototypeUrl.trim().length > 0 ||
    (activeDetail?.workItem.previewUrls.length ?? 0) > 0;
  const hasIssueOrAssignee =
    parsedIssue.number !== null || parsedIssue.url !== null || assigneeValue !== "unassigned";
  const hasDevBranch =
    branchName.trim().length > 0 ||
    (activeDetail?.changeRequests.length ?? 0) > 0 ||
    currentPhase === "dev" ||
    currentPhase === "review" ||
    currentPhase === "release" ||
    currentPhase === "done";
  const hasMergedPr = (activeDetail?.changeRequests ?? []).some((cr) => cr.state === "merged");
  const isReviewDone = hasMergedPr || currentPhase === "release" || currentPhase === "done";
  const isReleaseDone = isDoneStage;

  const rawLifecycleSteps: ReadonlyArray<{
    readonly id: CockpitStageArtKind;
    readonly label: string;
    readonly done: boolean;
    readonly focusId: string;
  }> = [
    { id: "intake", label: gt("Intake"), done: true, focusId: "wid-title" },
    { id: "prd", label: gt("AI PRD"), done: hasPrdArtifact, focusId: "wid-spec" },
    {
      id: "prototype",
      label: gt("Prototype"),
      done: hasPrototypeArtifact,
      focusId: "wid-prototype-url",
    },
    { id: "issue", label: gt("Issue & Assign"), done: hasIssueOrAssignee, focusId: "wid-issue" },
    { id: "dev", label: gt("Dev Branch"), done: hasDevBranch, focusId: "wid-branch" },
    { id: "review", label: gt("PR & Review"), done: isReviewDone, focusId: "wid-prs" },
    { id: "release", label: gt("Release"), done: isReleaseDone, focusId: "wid-gates" },
  ];

  const firstPendingStepIdx = rawLifecycleSteps.findIndex((step) => !step.done);
  const activeStepIndex =
    firstPendingStepIdx === -1 ? rawLifecycleSteps.length - 1 : firstPendingStepIdx;

  const isHotfixBranch = activeDetail
    ? activeDetail.workItem.priority === "p0" &&
      (activeDetail.workItem.itemType === "bug" || activeDetail.workItem.itemType === "security")
    : false;
  const branchTopologyPill =
    branchTopology === "single_trunk" || isHotfixBranch ? "origin/main" : "origin/dev -> main";
  const hasValidIssueUrl = Boolean(parsedIssue.url && isSafeExternalUrl(parsedIssue.url));
  const hasIssueLinked = parsedIssue.number !== null || hasValidIssueUrl;
  const hasValidPrototypeUrl = isSafeExternalUrl(prototypeUrl);
  const hasPrototypeLinked = prototypeUrl.trim().length > 0;

  const blockingPr =
    activeDetail?.changeRequests.find(
      (cr) => cr.triageBucket === "bot_blocked" || cr.triageBucket === "ci_blocked",
    ) ?? null;

  const recommendedPipelineAction: PipelineActionKind | null = !activeDetail
    ? null
    : blockingPr
      ? null
      : prdStatus === "none" && !specMarkdown.trim()
        ? "prd"
        : prdStatus !== "none" && prototypeStatus === "none" && !prototypeUrl.trim()
          ? "prototype"
          : !parsedIssue.number && !parsedIssue.url
            ? "issue"
            : activeDetail.changeRequests.length === 0 && !isDoneStage
              ? "dev"
              : null;

  const deliveryActionTiles: ReadonlyArray<{
    readonly action: PipelineActionKind;
    readonly stage: CockpitStageArtKind;
    readonly tone: CockpitIconBadgeTone;
    readonly title: string;
    readonly caption: string;
  }> = [
    {
      action: "prd",
      stage: "prd",
      tone: "info",
      title: gt("AI Draft PRD"),
      caption: gt("Generate spec, design tier, and acceptance criteria"),
    },
    {
      action: "prototype",
      stage: "prototype",
      tone: "violet",
      title: gt("AI Prototype"),
      caption: gt("Build a clickable UI preview from the PRD"),
    },
    {
      action: "issue",
      stage: "issue",
      tone: "warning",
      title: gt("Submit GitHub Issue"),
      caption: gt("Create a labeled issue and assign handoff"),
    },
    {
      action: "dev",
      stage: "dev",
      tone: "primary",
      title: gt("Start Dev Branch"),
      caption: gt("Open a governed branch and implement AC"),
    },
  ];

  const handleToggleChecklist = (itemId: string) => {
    setChecklistItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, verified: !item.verified } : item)),
    );
  };

  const handleRemoveChecklist = (itemId: string) => {
    setChecklistItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleAddChecklist = () => {
    const trimmed = newAcText.trim();
    if (!trimmed) return;
    const nextNum = checklistItems.length + 1;
    let candidate = `AC-${nextNum}`;
    const existingIds = new Set(checklistItems.map((item) => item.id));
    let offset = 1;
    while (existingIds.has(candidate)) {
      candidate = `AC-${nextNum + offset}`;
      offset += 1;
    }
    setChecklistItems((prev) => [...prev, { id: candidate, text: trimmed, verified: false }]);
    setNewAcText("");
  };

  const handleSave = async (stageOverride?: string) => {
    if (!workItemId || !activeDetail || !title.trim()) return;
    const targetStage = stageOverride ?? stage;
    setSaving(true);
    const nextPreviewUrls = buildNextPreviewUrls(activeDetail.workItem.previewUrls);
    const res = await updateWorkItem({
      environmentId,
      input: {
        workItemId,
        title: title.trim(),
        stage: targetStage,
        health,
        specMarkdown,
        previewUrls: nextPreviewUrls,
        checklistItems: [...checklistItems],
        assigneeType: decodedAssignee.assigneeType,
        assigneeUserId: decodedAssignee.assigneeUserId,
        assigneeRunnerId: decodedAssignee.assigneeRunnerId,
        attributes: buildLifecyclePatch(),
      },
    });
    setSaving(false);
    if (res._tag === "Success") {
      const savedStage = res.value.workItem.stage;
      setStage(savedStage);
      setDetail((prev) => (prev ? { ...prev, workItem: res.value.workItem } : prev));
      setInitialPrototypeUrl(prototypeUrl.trim());
      toastManager.add({
        title: stageOverride
          ? gt("Advanced to {stage}", {
              stage: stages.find((s) => s.id === savedStage)?.label ?? savedStage,
            })
          : gt("Work item saved"),
        type: "success",
      });
      onUpdated();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to save work item.")),
        type: "error",
      });
    }
  };

  const handleAdvanceStage = async () => {
    if (!nextStage) return;
    setAdvancingStage(true);
    await handleSave(nextStage.id);
    setAdvancingStage(false);
  };

  const handleGateDecision = async (
    gateKey: string,
    status: "approved" | "rejected",
    note?: string,
  ) => {
    if (!workItemId) return;
    setBusyGateKey(gateKey);
    const res = await approveGate({
      environmentId,
      input: {
        targetType: "work_item",
        targetId: workItemId,
        gateKey,
        status,
        ...(note?.trim() ? { note: note.trim() } : {}),
      },
    });
    setBusyGateKey(null);
    if (res._tag === "Success") {
      setRejectingGateKey(null);
      setRejectNote("");
      toastManager.add({
        title: status === "approved" ? gt("Gate approved") : gt("Gate rejected"),
        type: status === "approved" ? "success" : "warning",
      });
      onUpdated();
      const refreshed = await getDetail({ environmentId, input: { workItemId } });
      if (refreshed._tag === "Success") {
        hydrateFromDetail(refreshed.value);
      }
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to update gate decision.")),
        type: "error",
      });
    }
  };

  const handleUnlinkPr = async (changeRequestId: string) => {
    if (!workItemId) return;
    setUnlinkingCrId(changeRequestId);
    const res = await linkChangeRequest({
      environmentId,
      input: { changeRequestId, workItemId: null },
    });
    setUnlinkingCrId(null);
    if (res._tag === "Success") {
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              changeRequests: prev.changeRequests.filter((cr) => cr.id !== changeRequestId),
            }
          : prev,
      );
      toastManager.add({ title: gt("Pull request unlinked"), type: "success" });
      onUpdated();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to unlink pull request.")),
        type: "error",
      });
    }
  };

  const handleCopyBranchCommand = async () => {
    if (!effectiveBranchName) return;
    const command = buildBranchCheckoutCommand(
      effectiveBranchName,
      branchTopology,
      activeDetail?.workItem ?? null,
    );
    const copied = await copyTextToClipboard(command);
    toastManager.add({
      title: copied ? gt("Branch command copied") : gt("Clipboard is unavailable"),
      type: copied ? "success" : "error",
    });
  };

  const handleLaunchPipelineAction = async (action: PipelineActionKind) => {
    if (!activeDetail || !draftWorkItem || !selectedLocalProject) return;
    setLaunchingAction(action);

    let prompt = "";
    switch (action) {
      case "prd":
        prompt = buildPrdGenerationPrompt({
          workItem: draftWorkItem,
          project,
          memory,
          repoFullName: primaryRepoFullName,
          locale,
        });
        break;
      case "prototype":
        prompt = buildPrototypeGenerationPrompt({
          workItem: draftWorkItem,
          project,
          memory,
          repoFullName: primaryRepoFullName,
          locale,
        });
        break;
      case "issue":
        prompt = buildIssueDispatchPrompt({
          workItem: draftWorkItem,
          project,
          memory,
          repoFullName: primaryRepoFullName,
          assigneeHandle: resolvedAssigneeHandle,
          assigneeDisplayName: resolvedAssigneeDisplayName,
          locale,
        });
        break;
      case "dev":
        prompt = buildWorkItemThreadPrompt({
          workItem: draftWorkItem,
          project,
          memory,
          changeRequests: activeDetail.changeRequests,
          repoFullName: primaryRepoFullName,
          topology: branchTopology,
          locale,
        });
        break;
    }

    await handleNewThread(
      scopeProjectRef(selectedLocalProject.environmentId, selectedLocalProject.id),
      {
        prompt,
      },
    );
    setLaunchingAction(null);
    onClose();
  };

  const latestGates = resolveLatestGateApprovals(activeDetail?.gateApprovals ?? []);

  const guidedCallout: {
    readonly tone: CockpitIconBadgeTone;
    readonly dotTone: CockpitTone;
    readonly ring: boolean;
    readonly icon: ReactNode;
    readonly eyebrow: ReactNode;
    readonly meta?: ReactNode;
    readonly description: ReactNode;
    readonly action: ReactNode;
  } | null = activeDetail
    ? blockingPr
      ? {
          tone: "error",
          dotTone: "error",
          ring: true,
          icon: <ShieldAlertIcon />,
          eyebrow: <T>Next step</T>,
          meta: `${blockingPr.repoFullName}#${blockingPr.number}`,
          description:
            blockingPr.triageBucket === "bot_blocked" ? (
              <T>Automated review flagged blocking findings. Inspect and resolve before merging.</T>
            ) : (
              <T>CI checks failed on this pull request. Inspect the failing checks to unblock.</T>
            ),
          action: onOpenChangeRequest ? (
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                onOpenChangeRequest(blockingPr);
                onClose();
              }}
            >
              <T>Open Blocking PR</T>
              <ArrowRightIcon />
            </Button>
          ) : isSafeExternalUrl(blockingPr.url) ? (
            <Button
              render={
                <a href={blockingPr.url} rel="noreferrer" target="_blank">
                  <T>Open Blocking PR</T>
                  <ExternalLinkIcon />
                </a>
              }
              size="sm"
              variant="destructive"
            />
          ) : (
            <Button size="sm" variant="destructive" onClick={() => focusElementById("wid-prs")}>
              <T>Open Blocking PR</T>
              <ArrowRightIcon />
            </Button>
          ),
        }
      : prdStatus === "none" && !specMarkdown.trim()
        ? {
            tone: "info",
            dotTone: "info",
            ring: false,
            icon: <CockpitStageArtworkIcon stage="prd" />,
            eyebrow: <T>Next step</T>,
            description: (
              <T>
                No specification yet. Draft a structured PRD with design tier and acceptance
                criteria.
              </T>
            ),
            action: (
              <Button
                disabled={!selectedLocalProject || launchingAction !== null}
                size="sm"
                title={
                  !selectedLocalProject
                    ? gt("Add a local repository in the sidebar first.")
                    : undefined
                }
                variant="default"
                onClick={() => void handleLaunchPipelineAction("prd")}
              >
                {launchingAction === "prd" ? <T>Opening...</T> : <T>AI Draft PRD</T>}
                <ArrowRightIcon />
              </Button>
            ),
          }
        : prdStatus !== "none" && prototypeStatus === "none" && !prototypeUrl.trim()
          ? {
              tone: "violet",
              dotTone: "info",
              ring: false,
              icon: <CockpitStageArtworkIcon stage="prototype" />,
              eyebrow: <T>Next step</T>,
              description: (
                <T>
                  PRD is in place. Generate a clickable interactive prototype to validate the
                  experience early.
                </T>
              ),
              action: (
                <Button
                  disabled={!selectedLocalProject || launchingAction !== null}
                  size="sm"
                  title={
                    !selectedLocalProject
                      ? gt("Add a local repository in the sidebar first.")
                      : undefined
                  }
                  variant="default"
                  onClick={() => void handleLaunchPipelineAction("prototype")}
                >
                  {launchingAction === "prototype" ? <T>Opening...</T> : <T>AI Prototype</T>}
                  <ArrowRightIcon />
                </Button>
              ),
            }
          : !parsedIssue.number && !parsedIssue.url
            ? {
                tone: "warning",
                dotTone: "warning",
                ring: false,
                icon: <CockpitStageArtworkIcon stage="issue" />,
                eyebrow: <T>Next step</T>,
                description: (
                  <T>
                    Dispatch a labeled GitHub Issue to align scope and track implementation handoff.
                  </T>
                ),
                action: (
                  <Button
                    disabled={!selectedLocalProject || launchingAction !== null}
                    size="sm"
                    title={
                      !selectedLocalProject
                        ? gt("Add a local repository in the sidebar first.")
                        : undefined
                    }
                    variant="default"
                    onClick={() => void handleLaunchPipelineAction("issue")}
                  >
                    {launchingAction === "issue" ? <T>Opening...</T> : <T>Submit GitHub Issue</T>}
                    <ArrowRightIcon />
                  </Button>
                ),
              }
            : activeDetail.changeRequests.length === 0 && !isDoneStage
              ? {
                  tone: "primary",
                  dotTone: "info",
                  ring: false,
                  icon: <CockpitStageArtworkIcon stage="dev" />,
                  eyebrow: <T>Next step</T>,
                  description: (
                    <T>
                      Ready to build. Cut a governed dev branch and implement the acceptance
                      criteria.
                    </T>
                  ),
                  action: (
                    <Button
                      disabled={!selectedLocalProject || launchingAction !== null}
                      size="sm"
                      title={
                        !selectedLocalProject
                          ? gt("Add a local repository in the sidebar first.")
                          : undefined
                      }
                      variant="default"
                      onClick={() => void handleLaunchPipelineAction("dev")}
                    >
                      {launchingAction === "dev" ? <T>Opening...</T> : <T>Start Dev Branch</T>}
                      <ArrowRightIcon />
                    </Button>
                  ),
                }
              : nextStage
                ? {
                    tone: "primary",
                    dotTone: "info",
                    ring: false,
                    icon: <CockpitStageArtworkIcon stage="release" />,
                    eyebrow: <T>Next step</T>,
                    description: (
                      <T>
                        Artifacts are lined up. Advance this work item from{" "}
                        <Var>{selectedStageLabel}</Var> to <Var>{nextStage.label}</Var>.
                      </T>
                    ),
                    action: (
                      <Button
                        disabled={saving || !title.trim()}
                        size="sm"
                        variant="default"
                        onClick={() => void handleAdvanceStage()}
                      >
                        {advancingStage ? (
                          <T>Advancing...</T>
                        ) : (
                          <T>
                            Advance to <Var>{nextStage.label}</Var>
                          </T>
                        )}
                        <ArrowRightIcon />
                      </Button>
                    ),
                  }
                : {
                    tone: "success",
                    dotTone: "success",
                    ring: true,
                    icon: <CheckIcon />,
                    eyebrow: <T>Ready / Shipped</T>,
                    description: (
                      <T>All delivery steps and workflow stages are complete for this work item.</T>
                    ),
                    action: (
                      <Badge size="default" variant="success">
                        <CheckIcon />
                        {isDoneStage ? <T>Shipped</T> : <T>Ready</T>}
                      </Badge>
                    ),
                  }
    : null;

  return (
    <Dialog
      open={workItemId !== null}
      onOpenChange={(open) => {
        if (!open) {
          setRejectingGateKey(null);
          setRejectNote("");
          setSpecMode("edit");
          onClose();
        }
      }}
    >
      <DialogPopup className="max-w-5xl">
        <DialogHeader>
          {activeDetail ? (
            <div className="flex items-start gap-3">
              <CockpitIconBadge
                size="lg"
                tone={workItemTypeBadgeTone(activeDetail.workItem.itemType)}
              >
                <CockpitArtifactIcon kind={workItemTypeArtKind(activeDetail.workItem.itemType)} />
              </CockpitIconBadge>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-md border border-border/60 bg-muted/45 px-1.5 py-0.5 font-mono text-2xs font-medium text-foreground/90">
                    {activeDetail.workItem.code}
                  </span>
                  <CockpitPriorityDot priority={activeDetail.workItem.priority} />
                  <CockpitHealthDot health={health} label={workHealthLabel(health, gt)} />
                </div>
                <DialogTitle>{activeDetail.workItem.title}</DialogTitle>
                <DialogDescription>
                  <T>
                    Drive end-to-end delivery from requirement intake, AI PRD, and prototype to
                    GitHub issue, dev branch, PR review, and release.
                  </T>
                </DialogDescription>
              </div>
            </div>
          ) : (
            <>
              <DialogTitle>
                <T>Work Item Details</T>
              </DialogTitle>
              <DialogDescription>
                <T>
                  Drive end-to-end delivery from requirement intake, AI PRD, and prototype to GitHub
                  issue, dev branch, PR review, and release.
                </T>
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        <DialogPanel>
          {loading ? (
            <p className="py-6 text-sm text-muted-foreground">
              <T>Loading work item details...</T>
            </p>
          ) : loadError ? (
            <CockpitInlineAlert tone="error">{loadError}</CockpitInlineAlert>
          ) : activeDetail ? (
            <div className="space-y-4">
              <nav aria-label={gt("Delivery lifecycle")} className="overflow-x-auto">
                <ol className="flex min-w-max items-center gap-0.5 rounded-xl border border-border/55 bg-linear-to-b from-muted/30 to-muted/10 p-1.5">
                  {rawLifecycleSteps.map((step, index) => {
                    const isCurrent = index === activeStepIndex && !step.done;
                    return (
                      <li key={step.id} className="flex items-center gap-0.5">
                        <button
                          aria-current={isCurrent ? "step" : undefined}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            isCurrent
                              ? "bg-card/90 font-medium text-foreground shadow-2xs ring-1 ring-inset ring-primary/25"
                              : step.done
                                ? "text-foreground/90 hover:bg-card/55"
                                : "text-muted-foreground hover:bg-accent/35 hover:text-foreground",
                          )}
                          type="button"
                          onClick={() => focusElementById(step.focusId)}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                              step.done
                                ? "bg-success/15 text-success-foreground"
                                : isCurrent
                                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                                  : "bg-muted/60 text-muted-foreground/80",
                            )}
                          >
                            {step.done ? (
                              <CheckIcon className="size-3" />
                            ) : (
                              <CockpitStageArtworkIcon className="size-3" stage={step.id} />
                            )}
                          </span>
                          <span className="whitespace-nowrap">{step.label}</span>
                        </button>
                        {index < rawLifecycleSteps.length - 1 ? (
                          <ChevronRightIcon
                            aria-hidden
                            className="size-3 shrink-0 text-muted-foreground/35"
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </nav>

              {guidedCallout ? (
                <div
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border px-3.5 py-3 shadow-2xs ring-1 ring-inset ring-foreground/5 sm:flex-row sm:items-center sm:justify-between",
                    GUIDED_BAR_TONE_CLASS[guidedCallout.tone],
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <CockpitIconBadge size="md" tone={guidedCallout.tone}>
                      {guidedCallout.icon}
                    </CockpitIconBadge>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
                        <CockpitStatusDot ring={guidedCallout.ring} tone={guidedCallout.dotTone} />
                        <span>{guidedCallout.eyebrow}</span>
                        {guidedCallout.meta ? (
                          <span className="rounded border border-border/55 bg-background/60 px-1.5 py-0.5 font-mono text-2xs font-medium tracking-normal text-foreground normal-case">
                            {guidedCallout.meta}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs leading-snug text-foreground/95">
                        {guidedCallout.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center justify-end sm:pl-2">
                    {guidedCallout.action}
                  </div>
                </div>
              ) : null}

              <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="min-w-0 space-y-5">
                  <CockpitSurface className="overflow-hidden rounded-2xl" variant="grouped">
                    <CockpitStudioBanner
                      art="workitem_studio"
                      className="rounded-none border-0 border-b border-border/50 shadow-none ring-0"
                      compact
                      description={
                        <T>
                          Launch a scoped U3 Code agent thread with live spec, acceptance criteria,
                          and branch workflow guardrails.
                        </T>
                      }
                      eyebrow={
                        <span className="inline-flex items-center gap-1.5">
                          <CockpitArtifactIcon
                            className="size-3.5 text-primary"
                            kind="prompt_template"
                          />
                          <T>AI Delivery Actions</T>
                        </span>
                      }
                      title={<T>AI Delivery Studio</T>}
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/45 bg-muted/15 px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {localProjects.length > 0 && selectedLocalProject ? (
                          <div className="flex items-center gap-2">
                            <span className="text-2xs font-medium text-muted-foreground">
                              <T>Workspace</T>
                            </span>
                            <div className="w-52">
                              <Select
                                value={`${selectedLocalProject.environmentId}:${selectedLocalProject.id}`}
                                onValueChange={(value) => {
                                  if (value) setChosenLocalProjectId(value);
                                }}
                              >
                                <SelectTrigger
                                  aria-label={gt("Local workspace project")}
                                  size="compact"
                                >
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
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            <T>Add a local repository in the sidebar first.</T>
                          </span>
                        )}
                      </div>

                      {onOpenPromptSettings ? (
                        <Button
                          size="xs"
                          variant="ghost-muted"
                          onClick={() => {
                            onClose();
                            onOpenPromptSettings();
                          }}
                        >
                          <CockpitArtifactIcon kind="prompt_template" />
                          <T>Manage Prompts</T>
                        </Button>
                      ) : null}
                    </div>

                    <div className="grid gap-2.5 p-3.5 sm:grid-cols-2">
                      {deliveryActionTiles.map((tile) => {
                        const isLaunching = launchingAction === tile.action;
                        const isRecommended = recommendedPipelineAction === tile.action;
                        const isDisabled = !selectedLocalProject || launchingAction !== null;
                        return (
                          <button
                            key={tile.action}
                            className={cn(
                              "group flex min-w-0 flex-col justify-between gap-2.5 rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              isLaunching
                                ? "border-primary/50 bg-primary/8 shadow-xs"
                                : isDisabled
                                  ? "cursor-not-allowed border-border/45 bg-card/30 opacity-55"
                                  : isRecommended
                                    ? "cursor-pointer border-primary/35 bg-linear-to-b from-card/95 to-primary/6 shadow-2xs ring-1 ring-inset ring-primary/15 hover:border-primary/50 hover:from-card hover:to-primary/10 hover:shadow-xs"
                                    : "cursor-pointer border-border/55 bg-linear-to-b from-card/90 to-card/45 shadow-2xs hover:border-primary/40 hover:from-card hover:to-accent/35 hover:shadow-xs",
                            )}
                            disabled={isDisabled}
                            type="button"
                            onClick={() => void handleLaunchPipelineAction(tile.action)}
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <CockpitIconBadge size="md" tone={tile.tone}>
                                <CockpitStageArtworkIcon stage={tile.stage} />
                              </CockpitIconBadge>
                              <ArrowRightIcon
                                aria-hidden
                                className={cn(
                                  "size-3.5 shrink-0 transition-transform",
                                  isLaunching || isRecommended
                                    ? "translate-x-0.5 text-primary"
                                    : "text-muted-foreground/50 group-hover:translate-x-0.5 group-hover:text-primary",
                                )}
                              />
                            </div>
                            <div className="min-w-0 space-y-0.5">
                              <div className="truncate text-xs font-semibold tracking-tight text-foreground">
                                {isLaunching ? <T>Opening...</T> : tile.title}
                              </div>
                              <p className="line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
                                {tile.caption}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </CockpitSurface>

                  <section className="space-y-2">
                    <CockpitSectionHeader
                      action={
                        <div
                          aria-label={gt("Specification view mode")}
                          className="inline-flex items-center rounded-lg border border-border/60 bg-muted/35 p-0.5"
                          role="tablist"
                        >
                          <button
                            aria-selected={specMode === "edit"}
                            className={cn(
                              "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              specMode === "edit"
                                ? "bg-card text-foreground shadow-2xs ring-1 ring-inset ring-border/50"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            role="tab"
                            type="button"
                            onClick={() => setSpecMode("edit")}
                          >
                            <PencilIcon aria-hidden className="size-3" />
                            <T>Edit</T>
                          </button>
                          <button
                            aria-selected={specMode === "preview"}
                            className={cn(
                              "inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              specMode === "preview"
                                ? "bg-card text-foreground shadow-2xs ring-1 ring-inset ring-border/50"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                            role="tab"
                            type="button"
                            onClick={() => setSpecMode("preview")}
                          >
                            <EyeIcon aria-hidden className="size-3" />
                            <T>Preview</T>
                          </button>
                        </div>
                      }
                      icon={
                        <CockpitStageArtworkIcon className="text-muted-foreground/80" stage="prd" />
                      }
                      title={
                        specMode === "edit" ? (
                          <label className="cursor-pointer" htmlFor="wid-spec">
                            <T>Specification (PRD)</T>
                          </label>
                        ) : (
                          <T>Specification (PRD)</T>
                        )
                      }
                    />
                    {specMode === "edit" ? (
                      <Textarea
                        id="wid-spec"
                        placeholder={gt(
                          "Write requirements, architecture notes, or rollout constraints",
                        )}
                        rows={6}
                        value={specMarkdown}
                        onChange={(event) => setSpecMarkdown(event.target.value)}
                      />
                    ) : (
                      <SpecMarkdownPreview
                        markdown={specMarkdown}
                        onSwitchToEdit={() => setSpecMode("edit")}
                      />
                    )}
                  </section>

                  <section className="space-y-2">
                    <CockpitSectionHeader
                      action={
                        <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                          {verifiedCount}/{checklistItems.length}
                        </span>
                      }
                      icon={<CheckSquareIcon className="text-muted-foreground/80" />}
                      title={<T>Acceptance Criteria</T>}
                    />

                    <CockpitSurface divided variant="grouped">
                      <CockpitSurfaceRow className="space-y-2 bg-muted/10" density="compact">
                        <div className="flex items-center justify-between gap-2 text-2xs">
                          <span className="font-medium text-muted-foreground">
                            {checklistItems.length === 0 ? (
                              <T>Completion progress</T>
                            ) : allAcVerified ? (
                              <T>All criteria verified</T>
                            ) : (
                              <T>
                                <Var>{verifiedCount}</Var> of <Var>{checklistItems.length}</Var>{" "}
                                criteria verified
                              </T>
                            )}
                          </span>
                          <span
                            className={cn(
                              "font-mono font-semibold tabular-nums",
                              allAcVerified
                                ? "text-success-foreground"
                                : checklistItems.length > 0
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                            )}
                          >
                            {acPercent}%
                          </span>
                        </div>
                        <div
                          aria-label={gt("Acceptance criteria completion")}
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={acPercent}
                          className="h-1.5 w-full overflow-hidden rounded-full bg-muted/65"
                          role="progressbar"
                        >
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width] duration-300",
                              allAcVerified ? "bg-success" : "bg-primary",
                            )}
                            style={{ width: `${acPercent}%` }}
                          />
                        </div>
                      </CockpitSurfaceRow>

                      {checklistItems.length === 0 ? (
                        <CockpitSurfaceRow density="compact">
                          <p className="py-1 text-xs text-muted-foreground">
                            <T>No acceptance criteria yet. Add one below.</T>
                          </p>
                        </CockpitSurfaceRow>
                      ) : (
                        checklistItems.map((item) => {
                          const verified = item.verified;
                          return (
                            <CockpitSurfaceRow
                              key={item.id}
                              className="flex items-center justify-between gap-2.5"
                              density="compact"
                            >
                              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-xs">
                                <Checkbox
                                  checked={verified}
                                  onCheckedChange={() => handleToggleChecklist(item.id)}
                                />
                                <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                                  {item.id}
                                </span>
                                <span
                                  className={
                                    verified
                                      ? "text-muted-foreground line-through"
                                      : "text-foreground"
                                  }
                                >
                                  {item.text}
                                </span>
                              </label>
                              <Button
                                aria-label={gt("Remove acceptance criterion")}
                                size="icon-xs"
                                variant="ghost-muted"
                                onClick={() => handleRemoveChecklist(item.id)}
                              >
                                <Trash2Icon />
                              </Button>
                            </CockpitSurfaceRow>
                          );
                        })
                      )}

                      <CockpitSurfaceRow className="bg-muted/15" density="compact">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <Input
                              placeholder={gt("Add acceptance criterion...")}
                              size="sm"
                              value={newAcText}
                              onChange={(event) => setNewAcText(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  handleAddChecklist();
                                }
                              }}
                            />
                          </div>
                          <Button
                            disabled={!newAcText.trim()}
                            size="sm"
                            variant="outline"
                            onClick={handleAddChecklist}
                          >
                            <PlusIcon />
                            <T>Add AC</T>
                          </Button>
                        </div>
                      </CockpitSurfaceRow>
                    </CockpitSurface>
                  </section>

                  <section className="space-y-2" id="wid-prs">
                    <CockpitSectionHeader
                      count={activeDetail.changeRequests.length}
                      icon={
                        <CockpitStageArtworkIcon className="text-muted-foreground/80" stage="pr" />
                      }
                      title={<T>Linked Pull Requests</T>}
                    />
                    {activeDetail.changeRequests.length === 0 ? (
                      <CockpitSurface padding="sm" variant="subtle">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <T>
                            No PRs linked yet. Mention the work item code in a PR title or branch,
                            or link an orphan PR from Review Triage.
                          </T>
                        </p>
                      </CockpitSurface>
                    ) : (
                      <CockpitSurface divided variant="grouped">
                        {activeDetail.changeRequests.map((cr) => (
                          <CockpitSurfaceRow
                            key={cr.id}
                            className="flex items-center justify-between gap-2.5 text-xs"
                            density="compact"
                            interactive={onOpenChangeRequest !== undefined}
                          >
                            {onOpenChangeRequest ? (
                              <button
                                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-none"
                                type="button"
                                onClick={() => {
                                  onOpenChangeRequest(cr);
                                  onClose();
                                }}
                              >
                                <PullRequestGlyph.pullRequest className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="shrink-0 font-mono text-2xs font-medium text-foreground">
                                  {cr.repoFullName}#{cr.number}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                  {cr.title}
                                </span>
                              </button>
                            ) : (
                              <a
                                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                                href={cr.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                <PullRequestGlyph.pullRequest className="size-3.5 shrink-0 text-muted-foreground" />
                                <span className="shrink-0 font-mono text-2xs font-medium text-foreground">
                                  {cr.repoFullName}#{cr.number}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                  {cr.title}
                                </span>
                              </a>
                            )}

                            <div className="flex shrink-0 items-center gap-1.5">
                              <CockpitDiffStat additions={cr.additions} deletions={cr.deletions} />
                              <Badge
                                size="sm"
                                variant={
                                  cr.automatedReview.status === "blocking"
                                    ? "error"
                                    : cr.automatedReview.status === "pass" ||
                                        cr.automatedReview.status === "auto_merged"
                                      ? "success"
                                      : "secondary"
                                }
                              >
                                {reviewStatusLabel(cr.automatedReview.status, gt)}
                              </Badge>
                              <Button
                                aria-label={gt("Open on GitHub")}
                                render={
                                  <a href={cr.url} rel="noreferrer" target="_blank">
                                    <ExternalLinkIcon />
                                  </a>
                                }
                                size="icon-xs"
                                variant="ghost-muted"
                              />
                              <Button
                                aria-label={gt("Unlink pull request")}
                                disabled={unlinkingCrId === cr.id}
                                size="icon-xs"
                                variant="ghost-muted"
                                onClick={() => void handleUnlinkPr(cr.id)}
                              >
                                <UnlinkIcon />
                              </Button>
                            </div>
                          </CockpitSurfaceRow>
                        ))}
                      </CockpitSurface>
                    )}
                  </section>

                  {gates.length > 0 ? (
                    <section className="space-y-2" id="wid-gates">
                      <CockpitSectionHeader
                        count={gates.length}
                        icon={
                          <CockpitArtifactIcon
                            className="text-muted-foreground/80"
                            kind="governance"
                          />
                        }
                        title={<T>Workflow Approval Gates</T>}
                      />
                      <CockpitSurface divided variant="grouped">
                        {gates.map((gate) => {
                          const latest = latestGates.get(gate.key);
                          const status = latest?.status ?? null;
                          const isRejectingThis = rejectingGateKey === gate.key;
                          return (
                            <CockpitSurfaceRow
                              key={gate.key}
                              className="space-y-2 text-xs"
                              density="compact"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground">{gate.label}</span>
                                  {status === "approved" ? (
                                    <Badge size="sm" variant="success">
                                      <ShieldCheckIcon />
                                      <T>Approved</T>
                                    </Badge>
                                  ) : status === "rejected" ? (
                                    <Badge size="sm" variant="error">
                                      <ShieldAlertIcon />
                                      <T>Rejected</T>
                                    </Badge>
                                  ) : (
                                    <Badge size="sm" variant="secondary">
                                      <T>Pending</T>
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {status !== "approved" ? (
                                    <Button
                                      disabled={busyGateKey === gate.key}
                                      size="micro"
                                      variant="warning-outline"
                                      onClick={() => void handleGateDecision(gate.key, "approved")}
                                    >
                                      <ShieldCheckIcon />
                                      {busyGateKey === gate.key ? (
                                        <T>Approving...</T>
                                      ) : (
                                        <T>Approve</T>
                                      )}
                                    </Button>
                                  ) : null}
                                  <Button
                                    disabled={busyGateKey === gate.key}
                                    size="micro"
                                    variant="destructive-outline"
                                    onClick={() => {
                                      setRejectingGateKey(isRejectingThis ? null : gate.key);
                                      setRejectNote("");
                                    }}
                                  >
                                    <ShieldAlertIcon />
                                    <T>Reject</T>
                                  </Button>
                                </div>
                              </div>

                              {latest?.note ? (
                                <p
                                  className={
                                    status === "rejected"
                                      ? "text-destructive"
                                      : "text-muted-foreground"
                                  }
                                >
                                  <T>
                                    Note: <Var>{latest.note}</Var>
                                  </T>
                                </p>
                              ) : null}

                              {isRejectingThis ? (
                                <div className="flex flex-wrap items-center gap-2 pt-1">
                                  <div className="min-w-48 flex-1">
                                    <Input
                                      placeholder={gt("Rejection reason (notifies owners)...")}
                                      size="sm"
                                      value={rejectNote}
                                      onChange={(event) => setRejectNote(event.target.value)}
                                    />
                                  </div>
                                  <Button
                                    disabled={busyGateKey === gate.key}
                                    size="xs"
                                    variant="destructive"
                                    onClick={() =>
                                      void handleGateDecision(gate.key, "rejected", rejectNote)
                                    }
                                  >
                                    <T>Confirm Reject</T>
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => {
                                      setRejectingGateKey(null);
                                      setRejectNote("");
                                    }}
                                  >
                                    <T>Cancel</T>
                                  </Button>
                                </div>
                              ) : null}
                            </CockpitSurfaceRow>
                          );
                        })}
                      </CockpitSurface>
                    </section>
                  ) : null}

                  <section className="space-y-2">
                    <CockpitSectionHeader
                      count={activeDetail.pulses.length}
                      icon={<ActivityIcon className="text-muted-foreground/80" />}
                      title={<T>Pulse Activity</T>}
                    />
                    {activeDetail.pulses.length === 0 ? (
                      <CockpitSurface padding="sm" variant="subtle">
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <T>No pulses published yet. Sync a pulse from an active coding thread.</T>
                        </p>
                      </CockpitSurface>
                    ) : (
                      <CockpitSurface
                        className="max-h-56 overflow-y-auto"
                        divided
                        variant="grouped"
                      >
                        {activeDetail.pulses.map((pulse) => (
                          <CockpitSurfaceRow
                            key={pulse.id}
                            className="space-y-1.5 text-xs"
                            density="compact"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <Badge size="sm" variant="outline">
                                  {pulse.sourceType}
                                </Badge>
                                <CockpitHealthDot
                                  health={pulse.health}
                                  label={workHealthLabel(pulse.health, gt)}
                                />
                              </div>
                              <span className="font-mono text-2xs tabular-nums">
                                {pulse.createdAt.slice(0, 16).replace("T", " ")}
                              </span>
                            </div>
                            <p className="leading-relaxed text-foreground">{pulse.doneSummary}</p>
                            {pulse.decisions.length > 0 ? (
                              <p className="text-muted-foreground">
                                <T>
                                  Decisions: <Var>{pulse.decisions.join("; ")}</Var>
                                </T>
                              </p>
                            ) : null}
                            {pulse.blockers.length > 0 ? (
                              <p className="text-destructive">
                                <T>
                                  Blockers:{" "}
                                  <Var>{pulse.blockers.map((b) => b.text).join("; ")}</Var>
                                </T>
                              </p>
                            ) : null}
                            {pulse.nextStep ? (
                              <p className="text-muted-foreground">
                                <T>
                                  Next: <Var>{pulse.nextStep}</Var>
                                </T>
                              </p>
                            ) : null}
                          </CockpitSurfaceRow>
                        ))}
                      </CockpitSurface>
                    )}
                  </section>
                </div>

                <aside className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
                  <section className="space-y-2">
                    <CockpitSectionHeader
                      icon={<SlidersHorizontalIcon className="text-muted-foreground/80" />}
                      title={<T>Properties</T>}
                    />
                    <CockpitSurface divided variant="grouped">
                      <CockpitSurfaceRow className="space-y-3" density="compact">
                        <div>
                          <CockpitFieldLabel htmlFor="wid-title">
                            <T>Title</T>
                          </CockpitFieldLabel>
                          <Input
                            id="wid-title"
                            size="sm"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                          />
                        </div>

                        <div>
                          <div className="mb-1.5 flex items-center justify-between gap-1.5">
                            <label
                              className="text-xs font-medium text-muted-foreground"
                              htmlFor="wid-stage"
                            >
                              <T>Stage</T>
                            </label>
                            {nextStage ? (
                              <Button
                                disabled={saving || !title.trim()}
                                size="micro"
                                title={gt("Advance to {stage}", { stage: nextStage.label })}
                                variant="ghost"
                                onClick={() => void handleAdvanceStage()}
                              >
                                <T>Next stage</T>
                                <ArrowRightIcon />
                              </Button>
                            ) : null}
                          </div>
                          <Select
                            value={stage}
                            onValueChange={(value) => {
                              if (value) setStage(value);
                            }}
                          >
                            <SelectTrigger id="wid-stage" size="sm">
                              <SelectValue>{selectedStageLabel}</SelectValue>
                            </SelectTrigger>
                            <SelectPopup>
                              {stages.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  {s.label}
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                        </div>

                        <div>
                          <CockpitFieldLabel htmlFor="wid-assignee">
                            <T>Assignee</T>
                          </CockpitFieldLabel>
                          <Select
                            value={assigneeValue}
                            onValueChange={(value) => {
                              if (value) setAssigneeValue(value);
                            }}
                          >
                            <SelectTrigger id="wid-assignee" size="sm">
                              <SelectValue>
                                {decodedAssignee.assigneeType === "unassigned" ? (
                                  <T>Unassigned</T>
                                ) : decodedAssignee.assigneeType === "runner" ? (
                                  <span className="inline-flex items-center gap-1.5 truncate">
                                    <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                    <span className="truncate font-mono text-xs">
                                      @{decodedAssignee.assigneeRunnerId ?? DEFAULT_AGENT_RUNNER_ID}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 truncate">
                                    {resolvedAssigneeHandle ? (
                                      <CockpitSwarmAvatar
                                        displayName={
                                          resolvedAssigneeDisplayName ?? resolvedAssigneeHandle
                                        }
                                        handle={resolvedAssigneeHandle}
                                        kind="human"
                                        size="sm"
                                      />
                                    ) : null}
                                    <span className="truncate font-mono text-xs">
                                      {resolvedAssigneeHandle
                                        ? `@${resolvedAssigneeHandle}`
                                        : decodedAssignee.assigneeUserId}
                                    </span>
                                  </span>
                                )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectPopup>
                              <SelectItem value="unassigned">{gt("Unassigned")}</SelectItem>
                              {memberOptions.map((member) => (
                                <SelectItem key={member.value} value={member.value}>
                                  @{member.handle} · {member.displayName}
                                </SelectItem>
                              ))}
                              {customHumanAssigneeFallback ? (
                                <SelectItem value={customHumanAssigneeFallback.value}>
                                  {customHumanAssigneeFallback.label}
                                </SelectItem>
                              ) : null}
                              <SelectItem value={`runner:${DEFAULT_AGENT_RUNNER_ID}`}>
                                {gt("Coding Agent ({runnerId})", {
                                  runnerId: DEFAULT_AGENT_RUNNER_ID,
                                })}
                              </SelectItem>
                              {customRunnerAssigneeFallback ? (
                                <SelectItem value={customRunnerAssigneeFallback.value}>
                                  {gt("Coding Agent ({runnerId})", {
                                    runnerId: customRunnerAssigneeFallback.runnerId,
                                  })}
                                </SelectItem>
                              ) : null}
                            </SelectPopup>
                          </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <CockpitFieldLabel htmlFor="wid-health">
                              <T>Health</T>
                            </CockpitFieldLabel>
                            <Select
                              value={health}
                              onValueChange={(value) => {
                                if (
                                  value === "on_track" ||
                                  value === "at_risk" ||
                                  value === "blocked"
                                ) {
                                  setHealth(value);
                                }
                              }}
                            >
                              <SelectTrigger id="wid-health" size="sm">
                                <SelectValue>
                                  <CockpitHealthDot
                                    health={health}
                                    label={workHealthLabel(health, gt)}
                                  />
                                </SelectValue>
                              </SelectTrigger>
                              <SelectPopup>
                                <SelectItem value="on_track">{gt("On track")}</SelectItem>
                                <SelectItem value="at_risk">{gt("At risk")}</SelectItem>
                                <SelectItem value="blocked">{gt("Blocked")}</SelectItem>
                              </SelectPopup>
                            </Select>
                          </div>

                          <div>
                            <CockpitFieldLabel htmlFor="wid-design-tier">
                              <T>Design Tier</T>
                            </CockpitFieldLabel>
                            <Select
                              value={designTier}
                              onValueChange={(value) => {
                                if (
                                  value === "small" ||
                                  value === "medium" ||
                                  value === "large" ||
                                  value === "cross_repo"
                                ) {
                                  setDesignTier(value);
                                }
                              }}
                            >
                              <SelectTrigger id="wid-design-tier" size="sm">
                                <SelectValue>{designTierLabel(designTier, gt)}</SelectValue>
                              </SelectTrigger>
                              <SelectPopup>
                                <SelectItem value="small">{gt("Small")}</SelectItem>
                                <SelectItem value="medium">{gt("Medium")}</SelectItem>
                                <SelectItem value="large">{gt("Large")}</SelectItem>
                                <SelectItem value="cross_repo">{gt("Cross-repo")}</SelectItem>
                              </SelectPopup>
                            </Select>
                          </div>
                        </div>
                      </CockpitSurfaceRow>

                      <CockpitSurfaceRow className="space-y-2.5" density="compact">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            className="shrink-0 text-xs font-medium text-muted-foreground"
                            htmlFor="wid-start-date"
                          >
                            <T>Start Date</T>
                          </label>
                          <div className="w-38 shrink-0">
                            <Input
                              id="wid-start-date"
                              size="sm"
                              type="date"
                              value={plannedStartAt}
                              onChange={(event) => setPlannedStartAt(event.target.value)}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <label
                            className="shrink-0 text-xs font-medium text-muted-foreground"
                            htmlFor="wid-due-date"
                          >
                            <T>Due Date</T>
                          </label>
                          <div className="w-38 shrink-0">
                            <Input
                              id="wid-due-date"
                              size="sm"
                              type="date"
                              value={dueAt}
                              onChange={(event) => setDueAt(event.target.value)}
                            />
                          </div>
                        </div>
                      </CockpitSurfaceRow>

                      <CockpitSurfaceRow density="compact">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <CockpitFieldLabel htmlFor="wid-prd-status">
                              <T>PRD Status</T>
                            </CockpitFieldLabel>
                            <Select
                              value={prdStatus}
                              onValueChange={(value) => {
                                if (value === "none" || value === "draft" || value === "approved") {
                                  setPrdStatus(value);
                                }
                              }}
                            >
                              <SelectTrigger id="wid-prd-status" size="sm">
                                <SelectValue>{artifactStatusLabel(prdStatus, gt)}</SelectValue>
                              </SelectTrigger>
                              <SelectPopup>
                                <SelectItem value="none">{gt("None")}</SelectItem>
                                <SelectItem value="draft">{gt("Draft")}</SelectItem>
                                <SelectItem value="approved">{gt("Approved")}</SelectItem>
                              </SelectPopup>
                            </Select>
                          </div>

                          <div>
                            <CockpitFieldLabel htmlFor="wid-proto-status">
                              <T>Prototype Status</T>
                            </CockpitFieldLabel>
                            <Select
                              value={prototypeStatus}
                              onValueChange={(value) => {
                                if (value === "none" || value === "draft" || value === "approved") {
                                  setPrototypeStatus(value);
                                }
                              }}
                            >
                              <SelectTrigger id="wid-proto-status" size="sm">
                                <SelectValue>
                                  {artifactStatusLabel(prototypeStatus, gt)}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectPopup>
                                <SelectItem value="none">{gt("None")}</SelectItem>
                                <SelectItem value="draft">{gt("Draft")}</SelectItem>
                                <SelectItem value="approved">{gt("Approved")}</SelectItem>
                              </SelectPopup>
                            </Select>
                          </div>
                        </div>
                      </CockpitSurfaceRow>
                    </CockpitSurface>
                  </section>

                  <section className="space-y-2">
                    <CockpitSectionHeader
                      icon={
                        <CockpitStageArtworkIcon
                          className="text-muted-foreground/80"
                          stage="release"
                        />
                      }
                      title={<T>Git &amp; Delivery Artifacts</T>}
                    />

                    <CockpitSurface divided variant="grouped">
                      <CockpitSurfaceRow className="space-y-2.5" density="compact">
                        <div className="flex items-center gap-2">
                          <CockpitIconBadge size="sm" tone="primary">
                            <CockpitArtifactIcon kind="branch" />
                          </CockpitIconBadge>
                          <label
                            className="truncate text-xs font-medium text-foreground"
                            htmlFor="wid-branch"
                          >
                            <T>Development Branch</T>
                          </label>
                        </div>

                        <Input
                          font="mono"
                          id="wid-branch"
                          placeholder={suggestedBranch}
                          size="sm"
                          value={branchName}
                          onChange={(event) => setBranchName(event.target.value)}
                        />

                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <span className="inline-flex items-center rounded-md border border-border/55 bg-muted/35 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                            {branchTopologyPill}
                          </span>
                          <Button
                            disabled={!effectiveBranchName}
                            size="xs"
                            variant="outline"
                            onClick={() => void handleCopyBranchCommand()}
                          >
                            <CopyIcon />
                            <T>Copy command</T>
                          </Button>
                        </div>
                      </CockpitSurfaceRow>

                      {standardLabels.length > 0 ? (
                        <CockpitSurfaceRow className="space-y-2 bg-muted/10" density="compact">
                          <div className="flex items-center gap-1.5">
                            <CockpitArtifactIcon
                              className="size-3.5 shrink-0 text-muted-foreground/75"
                              kind="labels"
                            />
                            <span className="text-2xs font-medium text-muted-foreground">
                              <T>Standard GitHub Labels</T>
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {standardLabels.map((label) => (
                              <Badge key={label} size="sm" variant={gitHubLabelBadgeVariant(label)}>
                                {label}
                              </Badge>
                            ))}
                          </div>
                        </CockpitSurfaceRow>
                      ) : null}

                      <CockpitSurfaceRow className="space-y-2" density="compact">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <CockpitIconBadge size="sm" tone="info">
                              <CockpitArtifactIcon kind="github_issue" />
                            </CockpitIconBadge>
                            <label
                              className="truncate text-xs font-medium text-foreground"
                              htmlFor="wid-issue"
                            >
                              <T>GitHub Issue</T>
                            </label>
                          </div>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 text-2xs font-medium",
                              hasIssueLinked ? "text-success-foreground" : "text-muted-foreground",
                            )}
                          >
                            <CockpitStatusDot
                              ring={hasIssueLinked}
                              tone={hasIssueLinked ? "success" : "neutral"}
                            />
                            {hasIssueLinked ? <T>Linked</T> : <T>Not linked</T>}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <div className="min-w-0 flex-1">
                            <Input
                              font="mono"
                              id="wid-issue"
                              placeholder={gt("#42 or https://github.com/org/repo/issues/42")}
                              size="sm"
                              value={githubIssueInput}
                              onChange={(event) => setGithubIssueInput(event.target.value)}
                            />
                          </div>
                          {hasValidIssueUrl && parsedIssue.url ? (
                            <Button
                              aria-label={gt("Open GitHub Issue")}
                              render={
                                <a href={parsedIssue.url} rel="noreferrer" target="_blank">
                                  <ExternalLinkIcon />
                                  {gt("Open", { $context: "verb, opens an external link" })}
                                </a>
                              }
                              size="xs"
                              variant="outline"
                            />
                          ) : null}
                        </div>
                      </CockpitSurfaceRow>

                      <CockpitSurfaceRow className="space-y-2" density="compact">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <CockpitIconBadge size="sm" tone="violet">
                              <CockpitArtifactIcon kind="prototype" />
                            </CockpitIconBadge>
                            <label
                              className="truncate text-xs font-medium text-foreground"
                              htmlFor="wid-prototype-url"
                            >
                              <T>Prototype &amp; Preview</T>
                            </label>
                          </div>
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 text-2xs font-medium",
                              hasPrototypeLinked
                                ? "text-success-foreground"
                                : "text-muted-foreground",
                            )}
                          >
                            <CockpitStatusDot
                              ring={hasPrototypeLinked}
                              tone={hasPrototypeLinked ? "success" : "neutral"}
                            />
                            {hasPrototypeLinked ? <T>Linked</T> : <T>Not linked</T>}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <div className="min-w-0 flex-1">
                            <Input
                              font="mono"
                              id="wid-prototype-url"
                              placeholder={gt("https://preview.example.com/prototype")}
                              size="sm"
                              value={prototypeUrl}
                              onChange={(event) => setPrototypeUrl(event.target.value)}
                            />
                          </div>
                          {hasValidPrototypeUrl ? (
                            <Button
                              aria-label={gt("Open Prototype Preview")}
                              render={
                                <a href={prototypeUrl.trim()} rel="noreferrer" target="_blank">
                                  <ExternalLinkIcon />
                                  {gt("Open", { $context: "verb, opens an external link" })}
                                </a>
                              }
                              size="xs"
                              variant="outline"
                            />
                          ) : null}
                        </div>
                      </CockpitSurfaceRow>
                    </CockpitSurface>
                  </section>
                </aside>
              </div>
            </div>
          ) : null}
        </DialogPanel>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            <T>Close</T>
          </DialogClose>
          <Button
            disabled={saving || !activeDetail || !title.trim()}
            variant="default"
            onClick={() => void handleSave()}
          >
            {saving ? <T>Saving...</T> : <T>Save Changes</T>}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
