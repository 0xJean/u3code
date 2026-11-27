import type { TeamHubDigestsResult, TeamHubMemoryResult } from "@t3tools/contracts";
import { T, useGT, Var } from "gt-react";
import {
  AlertTriangleIcon,
  BotIcon,
  FileTextIcon,
  LayersIcon,
  LockIcon,
  PlusIcon,
  ShieldCheckIcon,
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
import { Switch } from "~/components/ui/switch";
import {
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

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed);
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
    <div className="max-h-80 space-y-2.5 overflow-y-auto px-4 py-3.5 text-xs leading-relaxed text-foreground/90">
      {blocks.map((block) => {
        if (block.kind === "heading") {
          const headingClass =
            block.level === 1
              ? "pt-1 text-sm font-semibold text-foreground"
              : block.level === 2
                ? "pt-1 text-xs font-semibold tracking-tight text-foreground"
                : "pt-0.5 text-xs font-medium text-muted-foreground";
          return (
            <h4 key={block.id} className={headingClass}>
              {renderInlineMarkdown(block.text)}
            </h4>
          );
        }
        if (block.kind === "list") {
          return (
            <ul
              key={block.id}
              className="space-y-1.5 pl-4 text-xs leading-relaxed text-foreground/90"
            >
              {block.items.map((item) => (
                <li key={item.id} className="list-disc marker:text-muted-foreground/70">
                  {renderInlineMarkdown(item.text)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={block.id} className="text-xs leading-relaxed text-foreground/90">
            {renderInlineMarkdown(block.text)}
          </p>
        );
      })}
    </div>
  );
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
  const [newDirectiveText, setNewDirectiveText] = useState("");

  const directives = memory?.directives ?? [];
  const architectureDecisions = memory?.architectureDecisions ?? [];
  const recurringRisks = memory?.recurringRisks ?? [];
  const digestList = digests?.digests ?? [];

  const handleSubmitDirective = () => {
    const trimmed = newDirectiveText.trim();
    if (!trimmed || savingDirectives || !selectedProjectId) return;
    setNewDirectiveText("");
    onAddDirective(trimmed);
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <section className="space-y-2">
          <CockpitSectionHeader
            action={
              memory ? (
                <Badge size="sm" variant="outline">
                  <T>
                    v<Var>{memory.version}</Var>
                  </T>
                </Badge>
              ) : null
            }
            count={directives.length}
            icon={<LockIcon />}
            title={<T>Owner Directives</T>}
          />
          <p className="px-1 text-xs text-muted-foreground">
            <T>Locked project rules preserved against AI overwrite during digest synthesis.</T>
          </p>

          <CockpitSurface divided variant="grouped">
            {directives.length === 0 ? (
              <CockpitSurfaceRow>
                <p className="py-1 text-xs text-muted-foreground">
                  <T>
                    No directives locked yet. Add permanent engineering or release guardrails below.
                  </T>
                </p>
              </CockpitSurfaceRow>
            ) : (
              directives.map((directive) => (
                <CockpitSurfaceRow
                  key={directive.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p
                      className={
                        directive.active
                          ? "text-xs leading-relaxed text-foreground"
                          : "text-xs leading-relaxed text-muted-foreground line-through"
                      }
                    >
                      {directive.text}
                    </p>
                    <p className="font-mono text-2xs text-muted-foreground/80">
                      @{directive.createdBy}
                    </p>
                  </div>
                  <Switch
                    aria-label={directive.active ? gt("Disable directive") : gt("Enable directive")}
                    checked={directive.active}
                    disabled={savingDirectives}
                    size="sm"
                    onCheckedChange={() => onToggleDirective(directive.id)}
                  />
                </CockpitSurfaceRow>
              ))
            )}

            <CockpitSurfaceRow className="bg-muted/15">
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
                  <T>Add</T>
                </Button>
              </div>
            </CockpitSurfaceRow>
          </CockpitSurface>
        </section>

        <section className="space-y-2">
          <CockpitSectionHeader
            count={architectureDecisions.length}
            icon={<LayersIcon />}
            title={<T>Architecture Decisions</T>}
          />

          {architectureDecisions.length === 0 ? (
            <CockpitSurface variant="grouped">
              <Empty size="compact">
                <EmptyMedia variant="icon">
                  <LayersIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    <T>No decisions synthesized yet</T>
                  </EmptyTitle>
                  <EmptyDescription>
                    <T>
                      Generate a digest to distill architecture decisions from work item pulses and
                      pull requests.
                    </T>
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CockpitSurface>
          ) : (
            <CockpitSurface divided variant="grouped">
              {architectureDecisions.map((adr) => (
                <CockpitSurfaceRow key={adr.id} className="space-y-1">
                  <p className="text-xs leading-relaxed font-medium text-foreground">
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
          )}
        </section>

        <section className="space-y-2">
          <CockpitSectionHeader
            count={recurringRisks.length}
            icon={<AlertTriangleIcon />}
            title={<T>Recurring Risks</T>}
          />

          {recurringRisks.length === 0 ? (
            <CockpitSurface variant="grouped">
              <Empty size="compact">
                <EmptyMedia variant="icon">
                  <ShieldCheckIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    <T>No recurring risks recorded</T>
                  </EmptyTitle>
                  <EmptyDescription>
                    <T>
                      Delivery bottlenecks and repeated quality blockers surfaced in digests will
                      appear here.
                    </T>
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </CockpitSurface>
          ) : (
            <CockpitSurface divided variant="grouped">
              {recurringRisks.map((risk) => (
                <CockpitSurfaceRow key={risk.id} className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <CockpitStatusDot
                      className="mt-1.5"
                      tone={risk.severity === "high" ? "error" : "warning"}
                    />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs font-medium text-foreground">{risk.title}</p>
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
          )}
        </section>
      </div>

      <section className="space-y-2">
        <CockpitSectionHeader
          action={
            <Button
              disabled={generatingDigest}
              size="xs"
              variant="default"
              onClick={onGenerateDigest}
            >
              <FileTextIcon />
              {generatingDigest ? <T>Synthesizing...</T> : <T>Generate Digest</T>}
            </Button>
          }
          count={digestList.length}
          icon={<BotIcon />}
          title={<T>AI Cockpit Digests</T>}
        />

        {digestList.length === 0 ? (
          <CockpitSurface variant="grouped">
            <Empty size="compact">
              <EmptyMedia variant="icon">
                <FileTextIcon />
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
                  onClick={onGenerateDigest}
                >
                  <FileTextIcon />
                  {generatingDigest ? <T>Synthesizing...</T> : <T>Generate First Digest</T>}
                </Button>
              </EmptyContent>
            </Empty>
          </CockpitSurface>
        ) : (
          <div className="space-y-3">
            {digestList.slice(0, 5).map((digest, index) => (
              <CockpitSurface key={digest.id} className="overflow-hidden" variant="grouped">
                <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/15 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge size="sm" variant={index === 0 ? "info" : "secondary"}>
                      {formatTriggerLabel(digest.triggerType, gt)}
                    </Badge>
                    {index === 0 ? (
                      <span className="text-2xs font-medium text-muted-foreground">
                        <T>Latest</T>
                      </span>
                    ) : null}
                  </div>
                  <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                    {digest.createdAt.slice(0, 16).replace("T", " ")}
                  </span>
                </div>
                <DigestProse markdown={digest.markdownBody} />
              </CockpitSurface>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
