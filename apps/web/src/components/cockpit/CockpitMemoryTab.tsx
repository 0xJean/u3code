import type { TeamHubDigestsResult, TeamHubMemoryResult } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  AlertTriangleIcon,
  BotIcon,
  FileTextIcon,
  LayersIcon,
  LockIcon,
  PlusIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

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
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import {
  CockpitArtifactIcon,
  CockpitIllustration,
  CockpitStageArtworkIcon,
} from "./CockpitArtwork";
import {
  CockpitIconBadge,
  CockpitSectionHeader,
  CockpitStatusDot,
  CockpitSurface,
  CockpitSurfaceRow,
} from "./CockpitPrimitives";

interface CockpitMemoryTabProps {
  readonly memory: TeamHubMemoryResult["memory"];
  readonly digests: TeamHubDigestsResult | null;
  readonly selectedProjectId: string;
  readonly savingDirectives: boolean;
  readonly generatingDigest: boolean;
  readonly onAddDirective: (text: string) => void;
  readonly onToggleDirective: (directiveId: string) => void;
  readonly onGenerateDigest: () => void;
}

type MemorySubTab = "digests" | "memory";

interface InlineToken {
  readonly id: string;
  readonly kind: "bold" | "code" | "text";
  readonly value: string;
}

function tokenizeInlineMarkdown(text: string): ReadonlyArray<InlineToken> {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  const tokens: InlineToken[] = [];
  let offset = 0;
  for (const part of parts) {
    if (!part) continue;
    const id = `${offset}:${part.length}`;
    offset += part.length;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      tokens.push({ id, kind: "bold", value: part.slice(2, -2) });
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      tokens.push({ id, kind: "code", value: part.slice(1, -1) });
    } else {
      tokens.push({ id, kind: "text", value: part });
    }
  }
  return tokens;
}

function renderInlineMarkdown(text: string): ReadonlyArray<ReactNode> {
  return tokenizeInlineMarkdown(text).map((token) => {
    if (token.kind === "bold") {
      return (
        <strong key={token.id} className="font-medium text-foreground">
          {token.value}
        </strong>
      );
    }
    if (token.kind === "code") {
      return (
        <code
          key={token.id}
          className="rounded bg-muted/70 px-1 py-0.5 font-mono text-2xs text-foreground"
        >
          {token.value}
        </code>
      );
    }
    return <Fragment key={token.id}>{token.value}</Fragment>;
  });
}

interface DigestListItem {
  readonly id: string;
  readonly text: string;
}

type DigestBlock =
  | {
      readonly id: string;
      readonly kind: "heading";
      readonly level: 1 | 2 | 3;
      readonly text: string;
    }
  | { readonly id: string; readonly kind: "list"; readonly items: ReadonlyArray<DigestListItem> }
  | { readonly id: string; readonly kind: "paragraph"; readonly text: string };

function parseDigestBlocks(markdown: string): ReadonlyArray<DigestBlock> {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: DigestBlock[] = [];
  let listItems: DigestListItem[] = [];
  let paragraphLines: string[] = [];
  let blockStartLine = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ id: `list:${blockStartLine}`, kind: "list", items: listItems });
      listItems = [];
    }
  };

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({
        id: `p:${blockStartLine}`,
        kind: "paragraph",
        text: paragraphLines.join(" "),
      });
      paragraphLines = [];
    }
  };

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const trimmed = (lines[lineNo] ?? "").trim();
    if (!trimmed) {
      flushList();
      flushParagraph();
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      flushList();
      flushParagraph();
      const level = Math.min(3, headingMatch[1]?.length ?? 2) as 1 | 2 | 3;
      blocks.push({
        id: `h:${lineNo}`,
        kind: "heading",
        level,
        text: headingMatch[2] ?? "",
      });
      continue;
    }

    const bulletMatch = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      flushParagraph();
      if (listItems.length === 0) blockStartLine = lineNo;
      listItems.push({ id: `li:${lineNo}`, text: bulletMatch[1] ?? "" });
      continue;
    }

    flushList();
    if (paragraphLines.length === 0) blockStartLine = lineNo;
    paragraphLines.push(trimmed);
  }

  flushList();
  flushParagraph();
  return blocks;
}

function DigestProse({ markdown }: { readonly markdown: string }) {
  const blocks = parseDigestBlocks(markdown);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 px-6 py-5 text-sm leading-6 text-foreground/90">
      {blocks.map((block) => {
        if (block.kind === "heading") {
          const headingClass =
            block.level === 1
              ? "pt-1.5 text-base font-semibold tracking-tight text-foreground"
              : block.level === 2
                ? "pt-1.5 text-sm font-semibold tracking-tight text-foreground"
                : "pt-1 text-xs font-semibold text-foreground/85";
          return (
            <h4 key={block.id} className={headingClass}>
              {renderInlineMarkdown(block.text)}
            </h4>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={block.id} className="space-y-2 pl-5 text-sm leading-6 text-foreground/90">
              {block.items.map((item) => (
                <li key={item.id} className="list-disc marker:text-muted-foreground/65">
                  {renderInlineMarkdown(item.text)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={block.id} className="text-sm leading-6 text-foreground/90">
            {renderInlineMarkdown(block.text)}
          </p>
        );
      })}
    </div>
  );
}

function formatDirectiveAuthor(createdBy: string | null | undefined): string | null {
  const trimmed = createdBy?.trim() ?? "";
  if (!trimmed) return null;
  const normalized = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!normalized) return null;
  if (/^usr_/i.test(normalized)) return null;
  if (!normalized.includes(" ") && normalized.length > 20) return null;
  return normalized;
}

function formatDigestTimestamp(createdAt: string): string {
  return createdAt.slice(0, 16).replace("T", " ");
}

function formatTriggerLabel(triggerType: string, gt: ReturnType<typeof useGT>): string {
  switch (triggerType) {
    case "manual":
      return gt("Manual");
    case "scheduled":
      return gt("Scheduled");
    case "release":
      return gt("Release");
    case "daily":
      return gt("Daily");
    default:
      return triggerType;
  }
}

function formatRiskSeverity(severity: string, gt: ReturnType<typeof useGT>): string {
  switch (severity) {
    case "high":
      return gt("High");
    case "medium":
      return gt("Medium");
    case "low":
      return gt("Low");
    default:
      return severity;
  }
}

export function CockpitMemoryTab({
  memory,
  digests,
  selectedProjectId,
  savingDirectives,
  generatingDigest,
  onAddDirective,
  onToggleDirective,
  onGenerateDigest,
}: CockpitMemoryTabProps) {
  const gt = useGT();
  const [activeSubTab, setActiveSubTab] = useState<MemorySubTab>("digests");
  const [selectedDigestId, setSelectedDigestId] = useState<string>("");
  const [newDirectiveText, setNewDirectiveText] = useState("");

  const directives = memory?.directives ?? [];
  const activeDirectivesCount = directives.filter((directive) => directive.active).length;
  const architectureDecisions = memory?.architectureDecisions ?? [];
  const recurringRisks = memory?.recurringRisks ?? [];
  const digestList = digests?.digests ?? [];

  const activeDigest =
    digestList.find((digest) => digest.id === selectedDigestId) ?? digestList[0] ?? null;
  const activeDigestIndex = activeDigest
    ? digestList.findIndex((digest) => digest.id === activeDigest.id)
    : -1;

  const formatDigestOptionLabel = (createdAt: string, index: number) => {
    const timestamp = formatDigestTimestamp(createdAt);
    return index === 0 ? gt("{timestamp} (Latest)", { timestamp }) : timestamp;
  };

  const handleSubmitDirective = () => {
    const trimmed = newDirectiveText.trim();
    if (!trimmed || savingDirectives || !selectedProjectId) return;
    setNewDirectiveText("");
    onAddDirective(trimmed);
  };

  const handleGenerateDigestClick = () => {
    setSelectedDigestId("");
    onGenerateDigest();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          aria-label={gt("Memory & Digests sections")}
          size="segmented"
          value={[activeSubTab]}
          variant="segmented"
          onValueChange={(next) => {
            const value = next[0];
            if (value === "digests" || value === "memory") {
              setActiveSubTab(value);
            }
          }}
        >
          <Toggle value="digests">
            <BotIcon />
            <T>AI Digests</T>
            {digestList.length > 0 ? (
              <span className="ml-1 tabular-nums opacity-60">{digestList.length}</span>
            ) : null}
          </Toggle>
          <Toggle value="memory">
            <LockIcon />
            <T>Directives & Memory</T>
            {activeDirectivesCount > 0 ? (
              <span className="ml-1 tabular-nums opacity-60">{activeDirectivesCount}</span>
            ) : null}
          </Toggle>
        </ToggleGroup>

        {activeSubTab === "digests" ? (
          <Button
            disabled={generatingDigest}
            size="sm"
            variant="default"
            onClick={handleGenerateDigestClick}
          >
            <FileTextIcon />
            {generatingDigest ? <T>Synthesizing...</T> : <T>Generate Digest</T>}
          </Button>
        ) : memory ? (
          <Badge size="sm" variant="outline">
            <T>
              v<Var>{memory.version}</Var>
            </T>
          </Badge>
        ) : null}
      </div>

      {activeSubTab === "digests" ? (
        !activeDigest ? (
          <CockpitSurface variant="grouped">
            <Empty size="compact">
              <EmptyMedia>
                <CockpitIllustration kind="empty_memory" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>
                  <T>No digests generated yet</T>
                </EmptyTitle>
                <EmptyDescription>
                  <T>
                    Synthesize recent work item pulses and pull request activity into an executive
                    summary and update living project memory.
                  </T>
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  disabled={generatingDigest}
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateDigestClick}
                >
                  <FileTextIcon />
                  {generatingDigest ? <T>Synthesizing...</T> : <T>Generate First Digest</T>}
                </Button>
              </EmptyContent>
            </Empty>
          </CockpitSurface>
        ) : (
          <CockpitSurface className="overflow-hidden border-border/60 bg-card/35" variant="grouped">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-muted/15 px-6 py-3.5">
              <div className="flex items-center gap-2.5">
                <CockpitIconBadge size="md" tone="violet">
                  <CockpitArtifactIcon kind="prompt_template" />
                </CockpitIconBadge>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold tracking-tight text-foreground">
                    <T>Executive Digest</T>
                  </span>
                  <Badge size="sm" variant={activeDigestIndex === 0 ? "info" : "secondary"}>
                    {formatTriggerLabel(activeDigest.triggerType, gt)}
                  </Badge>
                  {digestList.length === 1 ? (
                    <span className="text-2xs font-medium text-muted-foreground">
                      <T>Latest</T>
                    </span>
                  ) : null}
                </div>
              </div>

              {digestList.length > 1 ? (
                <div className="w-56">
                  <Select
                    value={activeDigest.id}
                    onValueChange={(nextId) => {
                      if (nextId) setSelectedDigestId(nextId);
                    }}
                  >
                    <SelectTrigger aria-label={gt("Digest history")} size="compact">
                      <SelectValue>
                        {formatDigestOptionLabel(activeDigest.createdAt, activeDigestIndex)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end">
                      {digestList.map((digest, index) => (
                        <SelectItem key={digest.id} value={digest.id}>
                          {formatDigestOptionLabel(digest.createdAt, index)}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : (
                <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                  {formatDigestTimestamp(activeDigest.createdAt)}
                </span>
              )}
            </div>

            <DigestProse markdown={activeDigest.markdownBody} />
          </CockpitSurface>
        )
      ) : (
        <div className="space-y-6">
          <section className="space-y-2.5">
            <CockpitSectionHeader
              count={directives.length}
              icon={
                <CockpitIconBadge size="sm" tone="primary">
                  <CockpitStageArtworkIcon stage="governance" />
                </CockpitIconBadge>
              }
              title={<T>Owner Directives</T>}
            />
            <p className="px-1 text-xs text-muted-foreground">
              <T>Locked project rules preserved against AI overwrite during digest synthesis.</T>
            </p>

            <CockpitSurface divided variant="grouped">
              {directives.length === 0 ? (
                <CockpitSurfaceRow className="px-5 py-3.5">
                  <p className="text-xs text-muted-foreground">
                    <T>
                      No directives locked yet. Add permanent engineering or release guardrails
                      below.
                    </T>
                  </p>
                </CockpitSurfaceRow>
              ) : (
                directives.map((directive) => {
                  const author = formatDirectiveAuthor(directive.createdBy);
                  return (
                    <CockpitSurfaceRow
                      key={directive.id}
                      className="flex items-center justify-between gap-4 px-5 py-3.5"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p
                          className={
                            directive.active
                              ? "text-sm leading-relaxed text-foreground"
                              : "text-sm leading-relaxed text-muted-foreground line-through"
                          }
                        >
                          {directive.text}
                        </p>
                        {author ? (
                          <p className="text-2xs text-muted-foreground/80">{author}</p>
                        ) : null}
                      </div>
                      <Switch
                        aria-label={
                          directive.active ? gt("Disable directive") : gt("Enable directive")
                        }
                        checked={directive.active}
                        disabled={savingDirectives}
                        size="sm"
                        onCheckedChange={() => onToggleDirective(directive.id)}
                      />
                    </CockpitSurfaceRow>
                  );
                })
              )}

              <CockpitSurfaceRow className="bg-muted/15 px-5 py-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      disabled={!selectedProjectId || savingDirectives}
                      placeholder={gt("Add permanent rule (e.g. Never auto-merge main)")}
                      size="sm"
                      value={newDirectiveText}
                      onChange={(event) => setNewDirectiveText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleSubmitDirective();
                        }
                      }}
                    />
                  </div>
                  <Button
                    disabled={savingDirectives || !newDirectiveText.trim() || !selectedProjectId}
                    size="sm"
                    variant="outline"
                    onClick={handleSubmitDirective}
                  >
                    <PlusIcon />
                    <T>Add rule</T>
                  </Button>
                </div>
              </CockpitSurfaceRow>
            </CockpitSurface>
          </section>

          {architectureDecisions.length === 0 && recurringRisks.length === 0 ? (
            <CockpitSurface variant="grouped">
              <Empty size="compact">
                <EmptyMedia>
                  <CockpitIllustration kind="empty_memory" />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    <T>No distilled project memory yet</T>
                  </EmptyTitle>
                  <EmptyDescription>
                    <T>
                      No architecture decisions or recurring risks distilled yet. Generate a digest
                      to synthesize them automatically.
                    </T>
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    disabled={generatingDigest}
                    size="sm"
                    variant="outline"
                    onClick={handleGenerateDigestClick}
                  >
                    <FileTextIcon />
                    {generatingDigest ? <T>Synthesizing...</T> : <T>Generate Digest</T>}
                  </Button>
                </EmptyContent>
              </Empty>
            </CockpitSurface>
          ) : (
            <>
              {architectureDecisions.length > 0 ? (
                <section className="space-y-2.5">
                  <CockpitSectionHeader
                    count={architectureDecisions.length}
                    icon={
                      <CockpitIconBadge size="sm" tone="info">
                        <LayersIcon />
                      </CockpitIconBadge>
                    }
                    title={<T>Architecture Decisions</T>}
                  />
                  <CockpitSurface divided variant="grouped">
                    {architectureDecisions.map((adr) => (
                      <CockpitSurfaceRow key={adr.id} className="space-y-1 px-5 py-3.5">
                        <p className="text-sm leading-relaxed font-medium text-foreground">
                          {adr.summary}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 font-mono text-2xs tabular-nums text-muted-foreground">
                          <span>{adr.date}</span>
                          {adr.repoFullName ? (
                            <span className="rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 text-foreground/80">
                              {adr.repoFullName}
                            </span>
                          ) : null}
                        </div>
                      </CockpitSurfaceRow>
                    ))}
                  </CockpitSurface>
                </section>
              ) : null}

              {recurringRisks.length > 0 ? (
                <section className="space-y-2.5">
                  <CockpitSectionHeader
                    count={recurringRisks.length}
                    icon={
                      <CockpitIconBadge size="sm" tone="warning">
                        <AlertTriangleIcon />
                      </CockpitIconBadge>
                    }
                    title={<T>Recurring Risks</T>}
                  />
                  <CockpitSurface divided variant="grouped">
                    {recurringRisks.map((risk) => (
                      <CockpitSurfaceRow
                        key={risk.id}
                        className="flex items-start justify-between gap-4 px-5 py-3.5"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-2.5">
                          <CockpitStatusDot
                            className="mt-1.5"
                            tone={risk.severity === "high" ? "error" : "warning"}
                          />
                          <div className="min-w-0 space-y-0.5">
                            <p className="text-sm font-medium text-foreground">{risk.title}</p>
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {risk.mitigation}
                            </p>
                          </div>
                        </div>
                        <Badge size="sm" variant={risk.severity === "high" ? "error" : "warning"}>
                          <T>
                            <Var>{formatRiskSeverity(risk.severity, gt)}</Var> x
                            <Var>{risk.occurrences}</Var>
                          </T>
                        </Badge>
                      </CockpitSurfaceRow>
                    ))}
                  </CockpitSurface>
                </section>
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  );
}
