import type { EnvironmentId } from "@t3tools/contracts";
import type { Project, ProjectMemory, ProjectRepo } from "@u3code/hub-contracts";
import { T, useGT, useLocale, Var } from "gt-react";
import { EyeIcon, EyeOffIcon, RotateCcwIcon, SaveIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { cn } from "~/lib/utils";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  CockpitArtifactIcon,
  CockpitIllustration,
  CockpitStageArtworkIcon,
  type CockpitStageArtKind,
} from "./CockpitArtwork";
import {
  CockpitIconBadge,
  CockpitSectionHeader,
  CockpitStatusDot,
  CockpitSurface,
  CockpitSurfaceRow,
  type CockpitIconBadgeTone,
} from "./CockpitPrimitives";
import { formatCockpitCommandError } from "./cockpitError";
import {
  COCKPIT_PROMPT_SLOTS,
  PROMPT_SLOT_VARIABLES,
  getDefaultPromptTemplate,
  previewCockpitPromptSlot,
  resolvePromptLanguageName,
  type CockpitPromptSlot,
} from "./workItemPrompt";

interface CockpitPromptsSectionProps {
  readonly environmentId: EnvironmentId;
  readonly project: Project | null;
  readonly memory?: ProjectMemory | null | undefined;
  readonly repos: ReadonlyArray<ProjectRepo>;
  readonly onSaved: () => void;
}

function getPromptSlotMeta(
  slot: CockpitPromptSlot,
  gt: ReturnType<typeof useGT>,
): { readonly label: string; readonly description: string } {
  switch (slot) {
    case "prd":
      return {
        label: gt("AI Draft PRD"),
        description: gt(
          "Used when drafting structured PRDs, acceptance criteria, and technical design tiers.",
        ),
      };
    case "prototype":
      return {
        label: gt("AI Prototype"),
        description: gt("Used when generating interactive clickable UI prototypes from a PRD."),
      };
    case "issue_dispatch":
      return {
        label: gt("Submit GitHub Issue"),
        description: gt(
          "Used when creating labeled GitHub issues and handing off to an assignee on the Board.",
        ),
      };
    case "dev_branch":
      return {
        label: gt("Start Dev Branch"),
        description: gt(
          "Used when engineers or agents start implementing a work item on a governed branch.",
        ),
      };
    case "pr_audit":
      return {
        label: gt("PR Auto-Audit & Review"),
        description: gt(
          "Used when AI audits a pull request, checks guardrails, and submits GitHub reviews.",
        ),
      };
    case "pr_fix":
      return {
        label: gt("PR Fix Blockers"),
        description: gt("Used when an agent resolves automated reviewer findings or CI failures."),
      };
    case "repo_governance":
      return {
        label: gt("Repo Governance Bootstrap"),
        description: gt(
          "Used when auditing or bootstrapping .github templates, CI workflows, and labels.",
        ),
      };
  }
}

function getPromptSlotVisual(slot: CockpitPromptSlot): {
  readonly stage: CockpitStageArtKind;
  readonly tone: CockpitIconBadgeTone;
} {
  switch (slot) {
    case "prd":
      return { stage: "prd", tone: "info" };
    case "prototype":
      return { stage: "prototype", tone: "violet" };
    case "issue_dispatch":
      return { stage: "issue", tone: "warning" };
    case "dev_branch":
      return { stage: "dev", tone: "primary" };
    case "pr_audit":
      return { stage: "review", tone: "success" };
    case "pr_fix":
      return { stage: "pr", tone: "error" };
    case "repo_governance":
      return { stage: "governance", tone: "neutral" };
  }
}

export function CockpitPromptsSection({
  environmentId,
  project,
  memory,
  repos,
  onSaved,
}: CockpitPromptsSectionProps) {
  const gt = useGT();
  const locale = useLocale();
  const [selectedSlot, setSelectedSlot] = useState<CockpitPromptSlot>("prd");
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string>>({});
  const [showPreview, setShowPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const updateProjectPrompts = useAtomCommand(teamHubEnvironment.updateProjectPrompts, {
    reportFailure: false,
  });

  if (!project) {
    return (
      <CockpitSurface variant="grouped">
        <Empty size="compact">
          <EmptyMedia>
            <CockpitIllustration kind="empty_prompts" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              <T>Select a project first</T>
            </EmptyTitle>
            <EmptyDescription>
              <T>
                Choose or create a project to customize shared AI workflow prompts for your team.
              </T>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CockpitSurface>
    );
  }

  const savedTemplates = project.workflowConfig.promptTemplates ?? {};
  const draftKey = `${project.id}:${selectedSlot}`;
  const defaultTemplate = getDefaultPromptTemplate(selectedSlot, locale);
  const savedSlotTemplate = savedTemplates[selectedSlot]?.trim() ?? "";
  const isCustomSaved = savedSlotTemplate.length > 0;
  const editorValue = Object.hasOwn(draftOverrides, draftKey)
    ? (draftOverrides[draftKey] ?? "")
    : isCustomSaved
      ? savedSlotTemplate
      : defaultTemplate;
  const hasUnsavedChanges =
    Object.hasOwn(draftOverrides, draftKey) &&
    editorValue.trim() !== (isCustomSaved ? savedSlotTemplate : defaultTemplate).trim();

  const selectedMeta = getPromptSlotMeta(selectedSlot, gt);
  const selectedVisual = getPromptSlotVisual(selectedSlot);
  const slotVariables = PROMPT_SLOT_VARIABLES[selectedSlot];
  const languageLabel = resolvePromptLanguageName(locale);
  const customizedCount = COCKPIT_PROMPT_SLOTS.filter(
    (slot) => (savedTemplates[slot]?.trim().length ?? 0) > 0,
  ).length;

  const setEditorValue = (nextValue: string) => {
    setDraftOverrides((prev) => ({ ...prev, [draftKey]: nextValue }));
  };

  const handleInsertVariable = (variableName: string) => {
    const token = `{{${variableName}}}`;
    const separator = editorValue.length === 0 || /\s$/.test(editorValue) ? "" : " ";
    setEditorValue(`${editorValue}${separator}${token}`);
  };

  const persistSlotTemplate = async (nextSlotValue: string | null) => {
    setSaving(true);
    const nextMap: Record<string, string> = {};
    for (const [key, val] of Object.entries(savedTemplates)) {
      if (key !== selectedSlot && val.trim().length > 0) {
        nextMap[key] = val.trim();
      }
    }
    if (nextSlotValue && nextSlotValue.trim().length > 0) {
      nextMap[selectedSlot] = nextSlotValue.trim();
    }

    const res = await updateProjectPrompts({
      environmentId,
      input: {
        projectId: project.id,
        promptTemplates: nextMap,
      },
    });
    setSaving(false);

    if (res._tag === "Success") {
      setDraftOverrides((prev) => {
        const next = { ...prev };
        delete next[draftKey];
        return next;
      });
      toastManager.add({
        title: nextSlotValue
          ? gt("Team prompt template saved")
          : gt("Prompt reset to localized default"),
        type: "success",
      });
      onSaved();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to save prompt template.")),
        type: "error",
      });
    }
  };

  const renderedPreview = showPreview
    ? previewCockpitPromptSlot({
        slot: selectedSlot,
        project,
        memory,
        repoFullName: repos[0]?.repoFullName ?? null,
        locale,
        templateOverride: editorValue.trim() || defaultTemplate,
      })
    : "";

  return (
    <div className="space-y-5">
      <CockpitSectionHeader
        action={
          <span className="text-xs text-muted-foreground">
            <T>
              Active default language: <Var>{languageLabel}</Var>
            </T>
          </span>
        }
        count={`${customizedCount}/${COCKPIT_PROMPT_SLOTS.length}`}
        icon={
          <CockpitIconBadge size="sm" tone="primary">
            <CockpitArtifactIcon kind="prompt_template" />
          </CockpitIconBadge>
        }
        title={<T>Team Prompt Templates</T>}
      />

      <p className="text-xs leading-relaxed text-muted-foreground">
        <T>
          Customize the AI instructions used across this project&apos;s delivery stages. Saved
          templates sync to every teammate in <Var>{project.name}</Var>; uncustomized slots follow
          each user&apos;s interface language automatically.
        </T>
      </p>

      <div className="grid gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
        <CockpitSurface divided variant="grouped">
          {COCKPIT_PROMPT_SLOTS.map((slot) => {
            const meta = getPromptSlotMeta(slot, gt);
            const visual = getPromptSlotVisual(slot);
            const active = slot === selectedSlot;
            const customized = (savedTemplates[slot]?.trim().length ?? 0) > 0;
            return (
              <button
                key={slot}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2.5 px-3 py-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active
                    ? "bg-accent/60 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/30 hover:text-foreground",
                )}
                type="button"
                onClick={() => setSelectedSlot(slot)}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <CockpitIconBadge size="sm" tone={visual.tone}>
                    <CockpitStageArtworkIcon stage={visual.stage} />
                  </CockpitIconBadge>
                  <span className="truncate">{meta.label}</span>
                </span>
                <CockpitStatusDot tone={customized ? "success" : "neutral"} />
              </button>
            );
          })}
        </CockpitSurface>

        <CockpitSurface divided variant="grouped">
          <CockpitSurfaceRow className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <CockpitIconBadge size="lg" tone={selectedVisual.tone}>
                <CockpitStageArtworkIcon stage={selectedVisual.stage} />
              </CockpitIconBadge>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">{selectedMeta.label}</h3>
                  {isCustomSaved ? (
                    <Badge size="sm" variant="success">
                      <T>Team Custom</T>
                    </Badge>
                  ) : (
                    <Badge size="sm" variant="secondary">
                      <T>Built-in Default</T>
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{selectedMeta.description}</p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Button size="xs" variant="outline" onClick={() => setShowPreview((prev) => !prev)}>
                {showPreview ? <EyeOffIcon /> : <EyeIcon />}
                {showPreview ? <T>Hide Preview</T> : <T>Preview</T>}
              </Button>
              <Button
                disabled={saving || (!isCustomSaved && !hasUnsavedChanges)}
                size="xs"
                variant="ghost-muted"
                onClick={() => void persistSlotTemplate(null)}
              >
                <RotateCcwIcon />
                <T>Reset Default</T>
              </Button>
              <Button
                disabled={saving || !editorValue.trim() || (!hasUnsavedChanges && isCustomSaved)}
                size="xs"
                variant="default"
                onClick={() => void persistSlotTemplate(editorValue)}
              >
                <SaveIcon />
                {saving ? <T>Saving...</T> : <T>Save Template</T>}
              </Button>
            </div>
          </CockpitSurfaceRow>

          <CockpitSurfaceRow className="space-y-3">
            <div className="space-y-2 rounded-lg border border-border/45 bg-muted/15 p-2.5">
              <div className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
                <CockpitArtifactIcon
                  className="size-3.5 shrink-0 text-primary"
                  kind="prompt_template"
                />
                <span>
                  <T>Click a placeholder to insert</T>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {slotVariables.map((variableName) => (
                  <button
                    key={variableName}
                    className="cursor-pointer rounded-md border border-border/60 bg-background/80 px-2 py-0.5 font-mono text-2xs text-foreground/80 transition-colors hover:border-primary/40 hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    type="button"
                    onClick={() => handleInsertVariable(variableName)}
                  >
                    {`{{${variableName}}}`}
                  </button>
                ))}
              </div>
            </div>

            <Textarea
              aria-label={selectedMeta.label}
              rows={13}
              value={editorValue}
              onChange={(event) => setEditorValue(event.target.value)}
            />
          </CockpitSurfaceRow>

          {showPreview ? (
            <CockpitSurfaceRow className="space-y-2 bg-muted/15">
              <div className="text-2xs font-medium text-muted-foreground">
                <T>Rendered Preview (Sample Data)</T>
              </div>
              <pre className="max-h-72 overflow-y-auto rounded-lg border border-border/50 bg-background/80 p-3 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-foreground/90">
                {renderedPreview}
              </pre>
            </CockpitSurfaceRow>
          ) : null}
        </CockpitSurface>
      </div>
    </div>
  );
}
