import { useId } from "react";

import { cn } from "~/lib/utils";

export type CockpitStageArtKind =
  | "intake"
  | "prd"
  | "prototype"
  | "issue"
  | "dev"
  | "pr"
  | "review"
  | "release"
  | "governance";

export type CockpitArtifactArtKind =
  | "branch"
  | "github_issue"
  | "prototype"
  | "labels"
  | "prompt_template"
  | "governance"
  | "feature"
  | "bug"
  | "refactor"
  | "chore"
  | "security";

export type CockpitIllustrationKind =
  | "connect_hub"
  | "empty_work_items"
  | "empty_gantt"
  | "empty_board"
  | "empty_releases"
  | "empty_memory"
  | "empty_triage"
  | "empty_prompts"
  | "delivery_banner";

const DUOTONE_ICON_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 1.65,
} as const;

function BranchArtGeometry() {
  return (
    <>
      <circle cx="7" cy="5.6" fill="currentColor" fillOpacity="0.18" r="2.2" />
      <circle cx="7" cy="18.4" fill="currentColor" fillOpacity="0.18" r="2.2" />
      <circle cx="17" cy="6.4" fill="currentColor" fillOpacity="0.16" r="4.1" stroke="none" />
      <circle cx="17" cy="6.4" fill="currentColor" fillOpacity="0.22" r="2.4" />
      <circle cx="17" cy="6.4" fill="currentColor" r="0.95" stroke="none" />
      <path d="M7 7.8v8.4" />
      <path d="M7 16.2c0-2.9 2.1-4.4 5-4.4h2a3 3 0 0 0 3-3" />
    </>
  );
}

function PrototypeArtGeometry() {
  return (
    <>
      <path
        d="M5.5 3.8h13A2.5 2.5 0 0 1 21 6.3v1.5H3V6.3a2.5 2.5 0 0 1 2.5-2.5Z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="none"
      />
      <rect
        fill="currentColor"
        fillOpacity="0.2"
        height="5.2"
        rx="1.1"
        strokeWidth="1.35"
        width="5"
        x="5.4"
        y="9.9"
      />
      <path d="M12.2 17.8H5.5A2.5 2.5 0 0 1 3 15.3V6.3A2.5 2.5 0 0 1 5.5 3.8h13A2.5 2.5 0 0 1 21 6.3v6.2" />
      <path d="M3 7.8h18" />
      <circle cx="5.6" cy="5.8" fill="currentColor" r="0.7" stroke="none" />
      <circle cx="7.9" cy="5.8" fill="currentColor" r="0.7" stroke="none" />
      <path d="M12.7 10.6h5.5" />
      <path d="M14.2 13.6 20.3 16l-2.5.9-.9 2.5-2.7-5.8Z" fill="currentColor" fillOpacity="0.24" />
    </>
  );
}

function GovernanceArtGeometry() {
  return (
    <>
      <path d="M12 3.2 4.8 5.8v4.8H12V3.2Z" fill="currentColor" fillOpacity="0.24" stroke="none" />
      <path
        d="M12 10.6h7.2v.8c0 4.5-3 8-7.2 9.6V10.6Z"
        fill="currentColor"
        fillOpacity="0.16"
        stroke="none"
      />
      <path d="M12 3.2 19.2 5.8v5.6c0 4.5-3 8-7.2 9.6-4.2-1.6-7.2-5.1-7.2-9.6V5.8L12 3.2Z" />
      <path d="M12 3.6v17" strokeWidth="1.4" />
      <path d="M5.1 10.6h13.8" strokeWidth="1.4" />
    </>
  );
}

export function CockpitStageArtworkIcon({
  stage,
  className,
}: {
  readonly stage: CockpitStageArtKind;
  readonly className?: string;
}) {
  const iconClass = cn("size-4 shrink-0", className);

  switch (stage) {
    case "intake":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <path
            d="M3.5 13.4h4.3l1.5 2.2h5.4l1.5-2.2h4.3v4.4a2.7 2.7 0 0 1-2.7 2.7H6.2a2.7 2.7 0 0 1-2.7-2.7v-4.4Z"
            fill="currentColor"
            fillOpacity="0.18"
          />
          <path d="M3.5 13.4 5.2 7A2.2 2.2 0 0 1 7.3 5.3h9.4A2.2 2.2 0 0 1 18.8 7l1.7 6.4" />
          <path d="M12 3.2v7.6" />
          <path d="m9.2 8.2 2.8 2.8 2.8-2.8" />
        </svg>
      );
    case "prd":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <path
            d="M4.5 5.8A2.3 2.3 0 0 1 6.8 3.5h5.8l4.9 4.9v3.9a4.8 4.8 0 0 0-3.8 8.2H6.8a2.3 2.3 0 0 1-2.3-2.3V5.8Z"
            fill="currentColor"
            fillOpacity="0.14"
            stroke="none"
          />
          <path
            d="M12.6 3.5v3.4a1.5 1.5 0 0 0 1.5 1.5h3.4l-4.9-4.9Z"
            fill="currentColor"
            fillOpacity="0.22"
            stroke="none"
          />
          <path d="M11.8 20.5h-5a2.3 2.3 0 0 1-2.3-2.3V5.8A2.3 2.3 0 0 1 6.8 3.5h5.8l4.9 4.9v3.4" />
          <path d="M12.6 3.5v3.4a1.5 1.5 0 0 0 1.5 1.5h3.4" />
          <path d="M7.8 10.7h6.2" />
          <path d="M7.8 13.8h4" />
          <path d="M7.8 16.8h2.6" />
          <circle cx="17.1" cy="17.1" fill="currentColor" fillOpacity="0.2" r="3.6" />
          <path d="m15.6 17.1 1 1 2.1-2.2" strokeWidth="1.55" />
        </svg>
      );
    case "prototype":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <PrototypeArtGeometry />
        </svg>
      );
    case "issue":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <circle cx="12" cy="12" fill="currentColor" fillOpacity="0.14" r="8.4" />
          <circle cx="12" cy="12" fill="currentColor" fillOpacity="0.18" r="4.6" stroke="none" />
          <circle cx="12" cy="12" fill="currentColor" r="2.2" stroke="none" />
          <path d="M12 3.6v2.2" />
          <path d="M12 18.2v2.2" />
          <path d="M3.6 12h2.2" />
          <path d="M18.2 12h2.2" />
        </svg>
      );
    case "dev":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <BranchArtGeometry />
        </svg>
      );
    case "pr":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <circle cx="6.8" cy="5.5" fill="currentColor" fillOpacity="0.2" r="2.2" />
          <circle cx="6.8" cy="18.5" fill="currentColor" fillOpacity="0.2" r="2.2" />
          <circle cx="17.2" cy="18.5" fill="currentColor" fillOpacity="0.2" r="2.2" />
          <path d="M6.8 7.7v8.6" />
          <path d="M17.2 16.3v-4.1a4.4 4.4 0 0 0-4.4-4.4h-1.6" />
          <path d="m13.3 5.6-2.3 2.2 2.3 2.2" />
        </svg>
      );
    case "review":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <circle cx="10.8" cy="10.8" fill="currentColor" fillOpacity="0.16" r="6.7" />
          <path d="m8 10.9 1.9 1.9 3.7-3.8" />
          <path d="m15.7 15.7 4.4 4.4" strokeWidth="2" />
        </svg>
      );
    case "release":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <path
            d="M12 8.2 18.6 11.6 12 15l-6.6-3.4L12 8.2Z"
            fill="currentColor"
            fillOpacity="0.24"
            stroke="none"
          />
          <path
            d="M5.4 11.6 12 15v5.6l-6.6-3.4v-5.6Z"
            fill="currentColor"
            fillOpacity="0.13"
            stroke="none"
          />
          <path d="M12 8.2 18.6 11.6v5.6L12 20.6l-6.6-3.4v-5.6L12 8.2Z" />
          <path d="M5.4 11.6 12 15l6.6-3.4" />
          <path d="M12 15v5.6" />
          <path d="M12 7.8V3.2" />
          <path d="M9.4 5.5 12 3l2.6 2.5" />
        </svg>
      );
    case "governance":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <GovernanceArtGeometry />
        </svg>
      );
  }
}

export function CockpitArtifactIcon({
  kind,
  className,
}: {
  readonly kind: CockpitArtifactArtKind;
  readonly className?: string;
}) {
  const iconClass = cn("size-4 shrink-0", className);

  switch (kind) {
    case "branch":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <BranchArtGeometry />
        </svg>
      );
    case "github_issue":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <circle cx="12" cy="12" fill="currentColor" fillOpacity="0.14" r="8.2" stroke="none" />
          <path d="M19.8 9.4A8.2 8.2 0 1 1 14.6 4.2" />
          <circle cx="12" cy="12" fill="currentColor" r="2.4" stroke="none" />
          <circle cx="17.8" cy="6.2" fill="currentColor" fillOpacity="0.24" r="2.1" />
        </svg>
      );
    case "prototype":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <PrototypeArtGeometry />
        </svg>
      );
    case "labels":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <path
            d="M3.8 6a2.2 2.2 0 0 1 2.2-2.2h4a2.2 2.2 0 0 1 1.56.64l5.5 5.5a2 2 0 0 1 0 2.82l-4 4a2 2 0 0 1-2.82 0l-5.5-5.5a2.2 2.2 0 0 1-.64-1.56V6Z"
            fill="currentColor"
            fillOpacity="0.18"
          />
          <circle cx="7.6" cy="7.6" fill="currentColor" r="1.2" stroke="none" />
          <path d="M14.2 19.6a2 2 0 0 0 2.82 0l2.9-2.9a2 2 0 0 0 0-2.82l-4.2-4.2" />
        </svg>
      );
    case "prompt_template":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <rect
            fill="currentColor"
            fillOpacity="0.15"
            height="15.6"
            rx="2.8"
            width="17"
            x="3.5"
            y="4.2"
          />
          <path d="m7.2 9.4 2.2 2.1-2.2 2.1" />
          <path d="M11.6 10h5.4" />
          <path d="M11.6 13.3h3.6" />
          <path d="M7.2 16.5h6.6" />
          <rect
            fill="currentColor"
            fillOpacity="0.45"
            height="1.6"
            rx="0.8"
            stroke="none"
            width="3.2"
            x="14.2"
            y="6.4"
          />
        </svg>
      );
    case "governance":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <GovernanceArtGeometry />
        </svg>
      );
    case "feature":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <path d="M12 3.2 20.4 12 12 20.8 3.6 12 12 3.2Z" fill="currentColor" fillOpacity="0.14" />
          <path
            d="M12 7.4 16.4 12 12 16.6 7.6 12 12 7.4Z"
            fill="currentColor"
            fillOpacity="0.24"
            strokeWidth="1.4"
          />
          <path d="M12 3.4v4" strokeWidth="1.35" />
          <path d="M12 16.6v4" strokeWidth="1.35" />
        </svg>
      );
    case "bug":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <path d="M9.1 8.4a2.9 2.9 0 0 1 5.8 0" fill="currentColor" fillOpacity="0.24" />
          <rect
            fill="currentColor"
            fillOpacity="0.16"
            height="11.2"
            rx="4.6"
            width="9.2"
            x="7.4"
            y="8.2"
          />
          <path d="M12 10.8v8.4" strokeWidth="1.4" />
          <path d="M9.6 5.9 8.1 3.8" />
          <path d="m14.4 5.9 1.5-2.1" />
          <path d="M7.4 10.9H4.4" />
          <path d="M7.2 14H4.2" />
          <path d="m7.9 17.2-2.4 1.3" />
          <path d="M16.6 10.9h3" />
          <path d="M16.8 14h3" />
          <path d="m16.1 17.2 2.4 1.3" />
        </svg>
      );
    case "refactor":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <rect
            fill="currentColor"
            fillOpacity="0.24"
            height="5.2"
            rx="1.3"
            strokeWidth="1.4"
            width="5.2"
            x="9.4"
            y="9.4"
          />
          <path d="M5.4 10.4A7 7 0 0 1 17.4 7l1.8 1.8" />
          <path d="M19.2 5.2v3.6h-3.6" />
          <path d="M18.6 13.6A7 7 0 0 1 6.6 17l-1.8-1.8" />
          <path d="M4.8 18.8v-3.6h3.6" />
        </svg>
      );
    case "chore":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <path
            d="M15.4 5.1a4.4 4.4 0 0 0-4.8 6.1L5 16.8A1.56 1.56 0 0 0 7.2 19l5.6-5.6a4.4 4.4 0 0 0 6.1-4.8l-2 2-3.5-3.5 2-2Z"
            fill="currentColor"
            fillOpacity="0.18"
          />
          <circle cx="6.2" cy="17.8" fill="currentColor" r="0.85" stroke="none" />
        </svg>
      );
    case "security":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <path
            d="M12 3.2 19.2 5.8v5.5c0 4.6-3 8.1-7.2 9.7-4.2-1.6-7.2-5.1-7.2-9.7V5.8L12 3.2Z"
            fill="currentColor"
            fillOpacity="0.15"
          />
          <rect
            fill="currentColor"
            fillOpacity="0.26"
            height="4.8"
            rx="1.2"
            strokeWidth="1.45"
            width="6.4"
            x="8.8"
            y="11"
          />
          <path d="M10.2 11V9.3a1.8 1.8 0 0 1 3.6 0V11" strokeWidth="1.45" />
          <circle cx="12" cy="13.4" fill="currentColor" r="0.7" stroke="none" />
        </svg>
      );
  }
}

function DotGridDefs({ id }: { readonly id: string }) {
  return (
    <defs>
      <pattern height="12" id={id} patternUnits="userSpaceOnUse" width="12">
        <circle className="fill-muted-foreground/22" cx="2" cy="2" r="0.9" />
      </pattern>
    </defs>
  );
}

export function CockpitIllustration({
  kind,
  className,
}: {
  readonly kind: CockpitIllustrationKind;
  readonly className?: string;
}) {
  const patternId = `${useId().replaceAll(":", "")}-dot-grid`;

  if (kind === "delivery_banner") {
    return (
      <svg
        aria-hidden="true"
        className={cn("h-24 w-56 shrink-0", className)}
        fill="none"
        viewBox="0 0 260 112"
      >
        <DotGridDefs id={patternId} />
        <rect
          className="fill-muted/25 stroke-border/60"
          height="96"
          rx="14"
          strokeWidth="1"
          width="248"
          x="6"
          y="8"
        />
        <rect fill={`url(#${patternId})`} height="88" rx="12" width="240" x="10" y="12" />

        <ellipse className="fill-primary/9" cx="178" cy="54" rx="28" ry="22" />
        <ellipse className="fill-info/8" cx="82" cy="54" rx="26" ry="20" />
        <ellipse className="fill-success/8" cx="226" cy="54" rx="22" ry="20" />

        <rect
          className="fill-card stroke-border/75"
          height="12"
          rx="6"
          strokeWidth="1"
          width="50"
          x="64"
          y="16"
        />
        <circle className="fill-info" cx="72" cy="22" r="2.2" />
        <rect className="fill-muted-foreground/35" height="3" rx="1.5" width="28" x="78" y="20.5" />

        <rect
          className="fill-card stroke-border/75"
          height="12"
          rx="6"
          strokeWidth="1"
          width="58"
          x="154"
          y="16"
        />
        <circle className="fill-success" cx="162" cy="22" r="2.2" />
        <rect
          className="fill-muted-foreground/35"
          height="3"
          rx="1.5"
          width="36"
          x="168"
          y="20.5"
        />

        <path className="stroke-border" d="M34 54h192" strokeLinecap="round" strokeWidth="1.5" />
        <path className="stroke-primary/60" d="M34 54h144" strokeLinecap="round" strokeWidth="2" />
        <path
          className="stroke-info/55"
          d="M130 54c12 0 14 26 24 26s12-26 24-26"
          strokeDasharray="3 3"
          strokeLinecap="round"
          strokeWidth="1.35"
        />
        <circle className="fill-card stroke-info" cx="154" cy="80" r="3.2" strokeWidth="1.35" />

        <path
          className="stroke-muted-foreground/45"
          d="m57 51.5 2.5 2.5-2.5 2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
        />
        <path
          className="stroke-primary/65"
          d="m105 51.5 2.5 2.5-2.5 2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
        />
        <path
          className="stroke-primary/65"
          d="m153 51.5 2.5 2.5-2.5 2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
        />
        <path
          className="stroke-success/75"
          d="m201 51.5 2.5 2.5-2.5 2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
        />

        <g transform="translate(18, 38)">
          <rect
            className="fill-card stroke-border"
            height="32"
            rx="9"
            strokeWidth="1.15"
            width="32"
          />
          <rect className="fill-muted/50" height="20" rx="5.5" width="20" x="6" y="6" />
          <path
            className="stroke-muted-foreground/75"
            d="M10.5 16.5h2.6l1.1 1.6h3.6l1.1-1.6h2.6v3a1.6 1.6 0 0 1-1.6 1.6h-7.8a1.6 1.6 0 0 1-1.6-1.6v-3Z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.3"
          />
          <path
            className="stroke-muted-foreground/75"
            d="M16 10.8v4.5m-2-1.8 2 2 2-2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.3"
          />
        </g>
        <rect className="fill-muted-foreground/25" height="3.2" rx="1.6" width="20" x="24" y="77" />

        <g transform="translate(66, 38)">
          <rect
            className="fill-card stroke-info/55"
            height="32"
            rx="9"
            strokeWidth="1.15"
            width="32"
          />
          <rect className="fill-info/14" height="20" rx="5.5" width="20" x="6" y="6" />
          <path
            className="stroke-info"
            d="M11.5 10.8h6.4l2.6 2.6v7.4a1.2 1.2 0 0 1-1.2 1.2h-7.8a1.2 1.2 0 0 1-1.2-1.2V12a1.2 1.2 0 0 1 1.2-1.2Z"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.3"
          />
          <path
            className="stroke-info"
            d="M13 15.2h5.2M13 18h3.4"
            strokeLinecap="round"
            strokeWidth="1.3"
          />
        </g>
        <rect className="fill-info/45" height="3.2" rx="1.6" width="22" x="71" y="77" />

        <g transform="translate(114, 38)">
          <rect
            className="fill-card stroke-guest/55"
            height="32"
            rx="9"
            strokeWidth="1.15"
            width="32"
          />
          <rect className="fill-guest/14" height="20" rx="5.5" width="20" x="6" y="6" />
          <rect
            className="stroke-guest"
            height="10.5"
            rx="1.8"
            strokeWidth="1.3"
            width="12.5"
            x="9.8"
            y="10.8"
          />
          <path className="stroke-guest" d="M9.8 14h12.5M14.2 14v7.3" strokeWidth="1.2" />
        </g>
        <rect className="fill-guest/45" height="3.2" rx="1.6" width="22" x="119" y="77" />

        <g transform="translate(162, 38)">
          <rect
            className="fill-card stroke-primary/65"
            height="32"
            rx="9"
            strokeWidth="1.25"
            width="32"
          />
          <rect className="fill-primary/14" height="20" rx="5.5" width="20" x="6" y="6" />
          <circle className="stroke-primary" cx="12.6" cy="11.6" r="1.7" strokeWidth="1.3" />
          <circle className="stroke-primary" cx="12.6" cy="20.4" r="1.7" strokeWidth="1.3" />
          <circle
            className="fill-primary/25 stroke-primary"
            cx="19.6"
            cy="12.4"
            r="1.8"
            strokeWidth="1.3"
          />
          <path
            className="stroke-primary"
            d="M12.6 13.3v5.4m0 0c0-2.4 1.6-3.2 4-3.2h1.2a1.8 1.8 0 0 0 1.8-1.8"
            strokeLinecap="round"
            strokeWidth="1.3"
          />
        </g>
        <rect className="fill-primary/60" height="3.2" rx="1.6" width="24" x="166" y="77" />

        <g transform="translate(210, 38)">
          <rect
            className="fill-card stroke-success/60"
            height="32"
            rx="9"
            strokeWidth="1.15"
            width="32"
          />
          <rect className="fill-success/16" height="20" rx="5.5" width="20" x="6" y="6" />
          <path
            className="stroke-success"
            d="m11.8 16.3 2.8 2.8 5.6-5.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </g>
        <rect className="fill-success/55" height="3.2" rx="1.6" width="20" x="216" y="77" />
      </svg>
    );
  }

  const baseClass = cn("h-28 w-44 shrink-0", className);

  switch (kind) {
    case "connect_hub":
      return (
        <svg aria-hidden="true" className={baseClass} fill="none" viewBox="0 0 220 132">
          <DotGridDefs id={patternId} />
          <rect fill={`url(#${patternId})`} height="114" rx="16" width="196" x="12" y="9" />
          <circle className="fill-primary/9" cx="110" cy="66" r="40" />
          <circle
            className="stroke-border/65"
            cx="110"
            cy="66"
            r="34"
            strokeDasharray="3 4"
            strokeWidth="1"
          />

          <path
            className="stroke-border"
            d="M58 34c20 0 22 24 30 28"
            strokeLinecap="round"
            strokeWidth="1.35"
          />
          <path
            className="stroke-info/65"
            d="M162 34c-20 0-22 24-30 28"
            strokeLinecap="round"
            strokeWidth="1.35"
          />
          <path
            className="stroke-guest/60"
            d="M58 98c20 0 22-24 30-28"
            strokeLinecap="round"
            strokeWidth="1.35"
          />
          <path
            className="stroke-success/65"
            d="M162 98c-20 0-22-24-30-28"
            strokeLinecap="round"
            strokeWidth="1.35"
          />

          <circle className="fill-primary" cx="76" cy="48" r="2.2" />
          <circle className="fill-info" cx="144" cy="48" r="2.2" />
          <circle className="fill-guest" cx="76" cy="84" r="2.2" />
          <circle className="fill-success" cx="144" cy="84" r="2.2" />

          <g transform="translate(18, 20)">
            <rect
              className="fill-card stroke-border"
              height="28"
              rx="8"
              strokeWidth="1.15"
              width="40"
            />
            <circle
              className="fill-primary/20 stroke-primary"
              cx="12"
              cy="14"
              r="4"
              strokeWidth="1.2"
            />
            <rect
              className="fill-muted-foreground/40"
              height="3"
              rx="1.5"
              width="14"
              x="20"
              y="10"
            />
            <rect
              className="fill-muted-foreground/22"
              height="2.6"
              rx="1.3"
              width="10"
              x="20"
              y="15.5"
            />
          </g>

          <g transform="translate(162, 20)">
            <rect
              className="fill-card stroke-info/45"
              height="28"
              rx="8"
              strokeWidth="1.15"
              width="40"
            />
            <circle className="stroke-info" cx="11.5" cy="10.5" r="1.7" strokeWidth="1.25" />
            <circle className="stroke-info" cx="11.5" cy="18.2" r="1.7" strokeWidth="1.25" />
            <circle
              className="fill-info/25 stroke-info"
              cx="18.5"
              cy="11.5"
              r="1.7"
              strokeWidth="1.25"
            />
            <path
              className="stroke-info"
              d="M11.5 12.2v4.3m0 0c0-2.1 1.5-2.6 4.2-2.6h1a1.8 1.8 0 0 0 1.8-1.2"
              strokeLinecap="round"
              strokeWidth="1.2"
            />
            <rect className="fill-info/35" height="3" rx="1.5" width="11" x="24" y="12.5" />
          </g>

          <g transform="translate(18, 84)">
            <rect
              className="fill-card stroke-guest/45"
              height="28"
              rx="8"
              strokeWidth="1.15"
              width="40"
            />
            <rect
              className="fill-guest/18 stroke-guest/70"
              height="12"
              rx="3"
              strokeWidth="1.1"
              width="12"
              x="7"
              y="8"
            />
            <rect
              className="fill-muted-foreground/40"
              height="3"
              rx="1.5"
              width="13"
              x="22"
              y="10"
            />
            <rect className="fill-guest/35" height="2.6" rx="1.3" width="9" x="22" y="15.5" />
          </g>

          <g transform="translate(162, 84)">
            <rect
              className="fill-card stroke-success/45"
              height="28"
              rx="8"
              strokeWidth="1.15"
              width="40"
            />
            <circle
              className="fill-success/18 stroke-success"
              cx="13"
              cy="14"
              r="5"
              strokeWidth="1.2"
            />
            <path
              className="stroke-success"
              d="m11 14.1 1.3 1.3 2.7-2.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.3"
            />
            <rect className="fill-success/40" height="3" rx="1.5" width="12" x="22" y="10" />
            <rect
              className="fill-muted-foreground/25"
              height="2.6"
              rx="1.3"
              width="9"
              x="22"
              y="15.5"
            />
          </g>

          <rect
            className="fill-foreground/[0.04] dark:fill-black/30"
            height="48"
            rx="14"
            width="48"
            x="88"
            y="45"
          />
          <rect
            className="fill-card stroke-primary/55"
            height="48"
            rx="14"
            strokeWidth="1.4"
            width="48"
            x="86"
            y="42"
          />
          <rect
            className="fill-primary/10 stroke-primary/25"
            height="34"
            rx="9"
            strokeWidth="1"
            width="34"
            x="93"
            y="49"
          />
          <rect
            className="fill-card stroke-primary"
            height="7"
            rx="2.5"
            strokeWidth="1.3"
            width="20"
            x="100"
            y="55"
          />
          <circle className="fill-primary" cx="104.5" cy="58.5" r="1.2" />
          <rect className="fill-primary/45" height="2" rx="1" width="8.5" x="108" y="57.5" />
          <rect
            className="fill-card stroke-primary"
            height="7"
            rx="2.5"
            strokeWidth="1.3"
            width="20"
            x="100"
            y="66"
          />
          <circle className="fill-success" cx="104.5" cy="69.5" r="1.2" />
          <rect className="fill-primary/45" height="2" rx="1" width="8.5" x="108" y="68.5" />
          <circle className="fill-success stroke-card" cx="131" cy="45" r="4.5" strokeWidth="2" />
        </svg>
      );

    case "empty_work_items":
      return (
        <svg aria-hidden="true" className={baseClass} fill="none" viewBox="0 0 220 132">
          <DotGridDefs id={patternId} />
          <rect fill={`url(#${patternId})`} height="114" rx="16" width="196" x="12" y="9" />
          <ellipse className="fill-primary/8" cx="110" cy="64" rx="52" ry="38" />

          <rect
            className="fill-muted/35 stroke-border/65"
            height="94"
            rx="10"
            strokeWidth="1"
            width="50"
            x="20"
            y="20"
          />
          <rect className="fill-muted-foreground/28" height="4" rx="2" width="22" x="28" y="29" />
          <rect
            className="fill-card/85 stroke-border/70"
            height="34"
            rx="7"
            strokeWidth="1"
            width="38"
            x="26"
            y="40"
          />
          <circle className="fill-info/55" cx="33" cy="48" r="2.2" />
          <rect
            className="fill-muted-foreground/30"
            height="3"
            rx="1.5"
            width="18"
            x="39"
            y="46.5"
          />
          <rect
            className="fill-muted-foreground/20"
            height="2.6"
            rx="1.3"
            width="24"
            x="31"
            y="55"
          />
          <rect
            className="fill-muted-foreground/15"
            height="2.6"
            rx="1.3"
            width="16"
            x="31"
            y="61"
          />

          <rect
            className="fill-muted/35 stroke-border/65"
            height="94"
            rx="10"
            strokeWidth="1"
            width="50"
            x="150"
            y="20"
          />
          <rect className="fill-muted-foreground/28" height="4" rx="2" width="22" x="158" y="29" />
          <rect
            className="fill-card/85 stroke-border/70"
            height="34"
            rx="7"
            strokeWidth="1"
            width="38"
            x="156"
            y="40"
          />
          <circle className="fill-success/65" cx="163" cy="48" r="2.2" />
          <rect
            className="fill-muted-foreground/30"
            height="3"
            rx="1.5"
            width="18"
            x="169"
            y="46.5"
          />
          <rect
            className="fill-muted-foreground/20"
            height="2.6"
            rx="1.3"
            width="24"
            x="161"
            y="55"
          />
          <rect className="fill-success/30" height="4.5" rx="2.25" width="14" x="161" y="62" />

          <rect
            className="fill-muted/35 stroke-border/75"
            height="98"
            rx="10"
            strokeWidth="1"
            width="64"
            x="78"
            y="18"
          />
          <rect className="fill-primary/40" height="4" rx="2" width="26" x="86" y="26" />

          <rect
            className="fill-foreground/[0.04] dark:fill-black/30"
            height="46"
            rx="9"
            width="72"
            x="76"
            y="38"
          />
          <rect
            className="fill-card stroke-primary/50"
            height="46"
            rx="9"
            strokeWidth="1.25"
            width="72"
            x="74"
            y="35"
          />
          <path
            className="fill-primary/20 stroke-primary"
            d="m85 43.5 3.6 3.6-3.6 3.6-3.6-3.6 3.6-3.6Z"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
          <rect className="fill-foreground/65" height="3.6" rx="1.8" width="32" x="93" y="45" />
          <circle className="fill-warning" cx="136" cy="46.8" r="2.4" />
          <rect
            className="fill-muted-foreground/28"
            height="3"
            rx="1.5"
            width="46"
            x="82"
            y="56.5"
          />
          <rect
            className="fill-info/18 stroke-info/45"
            height="8"
            rx="4"
            strokeWidth="0.9"
            width="16"
            x="82"
            y="65.5"
          />
          <rect
            className="fill-guest/18 stroke-guest/45"
            height="8"
            rx="4"
            strokeWidth="0.9"
            width="18"
            x="102"
            y="65.5"
          />
          <rect
            className="fill-success/18 stroke-success/45"
            height="8"
            rx="4"
            strokeWidth="0.9"
            width="14"
            x="124"
            y="65.5"
          />

          <rect
            className="fill-primary/6 stroke-primary/45"
            height="22"
            rx="7"
            strokeDasharray="3.5 3"
            strokeWidth="1.1"
            width="52"
            x="84"
            y="88"
          />
          <path
            className="stroke-primary/80"
            d="M110 95v8m-4-4h8"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
        </svg>
      );

    case "empty_gantt":
      return (
        <svg aria-hidden="true" className={baseClass} fill="none" viewBox="0 0 220 132">
          <rect
            className="fill-card stroke-border"
            height="104"
            rx="12"
            strokeWidth="1.15"
            width="192"
            x="14"
            y="14"
          />
          <path
            className="fill-muted/35"
            d="M14 26a12 12 0 0 1 12-12h168a12 12 0 0 1 12 12v8H14v-8Z"
          />
          <path className="stroke-border/80" d="M14 34h192" strokeWidth="1" />
          <path className="stroke-border/75" d="M64 14v104" strokeWidth="1" />

          <rect
            className="fill-muted-foreground/30"
            height="3.2"
            rx="1.6"
            width="24"
            x="24"
            y="22.5"
          />
          <rect
            className="fill-muted-foreground/25"
            height="3.2"
            rx="1.6"
            width="16"
            x="74"
            y="22.5"
          />
          <rect
            className="fill-muted-foreground/25"
            height="3.2"
            rx="1.6"
            width="16"
            x="112"
            y="22.5"
          />
          <rect
            className="fill-muted-foreground/25"
            height="3.2"
            rx="1.6"
            width="16"
            x="150"
            y="22.5"
          />
          <rect
            className="fill-muted-foreground/25"
            height="3.2"
            rx="1.6"
            width="14"
            x="184"
            y="22.5"
          />

          <path className="stroke-border/45" d="M100 34v84" strokeDasharray="3 3" strokeWidth="1" />
          <path className="stroke-border/45" d="M138 34v84" strokeDasharray="3 3" strokeWidth="1" />
          <path className="stroke-border/45" d="M176 34v84" strokeDasharray="3 3" strokeWidth="1" />

          <path className="stroke-border/45" d="M14 62h192" strokeWidth="0.9" />
          <path className="stroke-border/45" d="M14 90h192" strokeWidth="0.9" />

          <circle className="fill-info" cx="25" cy="48" r="2.5" />
          <rect
            className="fill-muted-foreground/35"
            height="3.2"
            rx="1.6"
            width="24"
            x="32"
            y="46.4"
          />
          <circle className="fill-guest" cx="25" cy="76" r="2.5" />
          <rect
            className="fill-muted-foreground/35"
            height="3.2"
            rx="1.6"
            width="20"
            x="32"
            y="74.4"
          />
          <circle className="fill-success" cx="25" cy="104" r="2.5" />
          <rect
            className="fill-muted-foreground/35"
            height="3.2"
            rx="1.6"
            width="22"
            x="32"
            y="102.4"
          />

          <rect
            className="fill-info/16 stroke-info/60"
            height="14"
            rx="7"
            strokeWidth="1.1"
            width="54"
            x="72"
            y="41"
          />
          <rect className="fill-info/45" height="6" rx="3" width="30" x="76" y="45" />
          <path
            className="fill-warning/25 stroke-warning"
            d="m134 43 5 5-5 5-5-5 5-5Z"
            strokeLinejoin="round"
            strokeWidth="1.15"
          />

          <path
            className="stroke-muted-foreground/45"
            d="M126 48h4a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-28a4 4 0 0 0-4 4v6"
            strokeLinecap="round"
            strokeWidth="1.1"
          />

          <rect
            className="fill-guest/16 stroke-guest/60"
            height="14"
            rx="7"
            strokeWidth="1.1"
            width="64"
            x="96"
            y="69"
          />
          <rect className="fill-guest/45" height="6" rx="3" width="38" x="100" y="73" />

          <rect
            className="fill-success/16 stroke-success/60"
            height="14"
            rx="7"
            strokeWidth="1.1"
            width="54"
            x="134"
            y="97"
          />
          <rect className="fill-success/45" height="6" rx="3" width="22" x="138" y="101" />

          <path className="stroke-primary/75" d="M118 34v84" strokeWidth="1.4" />
          <rect className="fill-primary" height="6" rx="3" width="12" x="112" y="31" />
        </svg>
      );

    case "empty_board":
      return (
        <svg aria-hidden="true" className={baseClass} fill="none" viewBox="0 0 220 132">
          <DotGridDefs id={patternId} />
          <rect fill={`url(#${patternId})`} height="114" rx="16" width="196" x="12" y="9" />
          <ellipse className="fill-info/8" cx="122" cy="64" rx="58" ry="38" />

          <path className="stroke-border" d="M36 28v76" strokeLinecap="round" strokeWidth="1.4" />

          <circle className="fill-card stroke-info/65" cx="36" cy="34" r="9.5" strokeWidth="1.25" />
          <circle className="fill-info/25" cx="36" cy="34" r="6.5" />
          <circle className="fill-info" cx="36" cy="32.2" r="2.1" />
          <path
            className="stroke-info"
            d="M32.4 37.6a3.8 3.8 0 0 1 7.2 0"
            strokeLinecap="round"
            strokeWidth="1.3"
          />
          <rect
            className="fill-card stroke-border"
            height="28"
            rx="9"
            strokeWidth="1.15"
            width="142"
            x="54"
            y="20"
          />
          <rect
            className="fill-info/18 stroke-info/45"
            height="8"
            rx="4"
            strokeWidth="0.9"
            width="28"
            x="63"
            y="26.5"
          />
          <rect
            className="fill-muted-foreground/35"
            height="3.2"
            rx="1.6"
            width="66"
            x="96"
            y="29"
          />
          <rect
            className="fill-muted-foreground/20"
            height="2.8"
            rx="1.4"
            width="90"
            x="63"
            y="39"
          />

          <rect
            className="fill-card stroke-primary/65"
            height="19"
            rx="6"
            strokeWidth="1.25"
            width="19"
            x="26.5"
            y="58.5"
          />
          <rect className="fill-primary/18" height="13" rx="3.5" width="13" x="29.5" y="61.5" />
          <circle className="fill-primary" cx="33.8" cy="68" r="1.3" />
          <circle className="fill-primary" cx="38.2" cy="68" r="1.3" />

          <rect
            className="fill-foreground/[0.04] dark:fill-black/30"
            height="32"
            rx="9"
            width="148"
            x="56"
            y="56"
          />
          <rect
            className="fill-card stroke-primary/50"
            height="32"
            rx="9"
            strokeWidth="1.25"
            width="148"
            x="54"
            y="54"
          />
          <rect
            className="fill-guest/18 stroke-guest/45"
            height="8"
            rx="4"
            strokeWidth="0.9"
            width="34"
            x="63"
            y="61"
          />
          <rect className="fill-foreground/60" height="3.2" rx="1.6" width="54" x="102" y="63.5" />
          <rect
            className="fill-muted-foreground/26"
            height="2.8"
            rx="1.4"
            width="84"
            x="63"
            y="75"
          />
          <circle
            className="fill-success/18 stroke-success"
            cx="188"
            cy="70"
            r="6.5"
            strokeWidth="1.2"
          />
          <path
            className="stroke-success"
            d="m185.3 70.1 1.7 1.7 3.5-3.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.35"
          />

          <circle
            className="fill-muted/60 stroke-border"
            cx="36"
            cy="103"
            r="7"
            strokeWidth="1.15"
          />
          <rect
            className="fill-card/75 stroke-border"
            height="22"
            rx="8"
            strokeDasharray="3.5 3"
            strokeWidth="1.1"
            width="136"
            x="54"
            y="92"
          />
          <rect
            className="fill-muted-foreground/22"
            height="3"
            rx="1.5"
            width="58"
            x="64"
            y="101.5"
          />
          <path
            className="fill-primary/20 stroke-primary"
            d="m172 98.5 9.5 4.5-9.5 4.5 2.2-4.5-2.2-4.5Z"
            strokeLinejoin="round"
            strokeWidth="1.15"
          />
        </svg>
      );

    case "empty_releases":
      return (
        <svg aria-hidden="true" className={baseClass} fill="none" viewBox="0 0 220 132">
          <DotGridDefs id={patternId} />
          <rect fill={`url(#${patternId})`} height="114" rx="16" width="196" x="12" y="9" />
          <circle className="fill-success/9" cx="164" cy="66" r="38" />

          <path className="stroke-border" d="M22 48h108" strokeLinecap="round" strokeWidth="2" />
          <path
            className="stroke-info/75"
            d="M22 86h52c22 0 24-38 48-38h8"
            strokeLinecap="round"
            strokeWidth="2"
          />

          <circle
            className="fill-card stroke-muted-foreground/55"
            cx="42"
            cy="48"
            r="4.5"
            strokeWidth="1.5"
          />
          <circle
            className="fill-card stroke-muted-foreground/55"
            cx="84"
            cy="48"
            r="4.5"
            strokeWidth="1.5"
          />
          <circle className="fill-info/20 stroke-info" cx="42" cy="86" r="4.5" strokeWidth="1.5" />
          <circle className="fill-info/20 stroke-info" cx="72" cy="86" r="4.5" strokeWidth="1.5" />
          <circle
            className="fill-primary/20 stroke-primary"
            cx="114"
            cy="48"
            r="5.5"
            strokeWidth="1.6"
          />
          <circle className="fill-primary" cx="114" cy="48" r="2" />

          <rect
            className="fill-muted/55 stroke-border/75"
            height="10"
            rx="5"
            strokeWidth="0.9"
            width="28"
            x="28"
            y="28"
          />
          <rect
            className="fill-muted-foreground/40"
            height="2.6"
            rx="1.3"
            width="16"
            x="34"
            y="31.7"
          />
          <rect
            className="fill-info/14 stroke-info/45"
            height="10"
            rx="5"
            strokeWidth="0.9"
            width="26"
            x="28"
            y="96"
          />
          <rect className="fill-info/60" height="2.6" rx="1.3" width="14" x="34" y="99.7" />

          <rect
            className="fill-foreground/[0.04] dark:fill-black/30"
            height="76"
            rx="13"
            width="68"
            x="134"
            y="31"
          />
          <rect
            className="fill-card stroke-success/50"
            height="76"
            rx="13"
            strokeWidth="1.3"
            width="68"
            x="132"
            y="28"
          />
          <path className="fill-success/24" d="m166 43 16 8.2-16 8.2-16-8.2 16-8.2Z" />
          <path className="fill-success/12" d="m150 51.2 16 8.2v15.4l-16-8.2V51.2Z" />
          <path
            className="stroke-success"
            d="m166 43 16 8.2v15.4l-16 8.2-16-8.2V51.2L166 43Z"
            strokeLinejoin="round"
            strokeWidth="1.45"
          />
          <path
            className="stroke-success"
            d="m150 51.2 16 8.2 16-8.2M166 59.4v15.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.35"
          />
          <rect
            className="fill-success/15 stroke-success/45"
            height="12"
            rx="6"
            strokeWidth="1"
            width="44"
            x="144"
            y="82"
          />
          <circle className="fill-success" cx="152" cy="88" r="2.2" />
          <rect className="fill-success/65" height="3" rx="1.5" width="22" x="158" y="86.5" />

          <circle className="fill-card stroke-success" cx="196" cy="32" r="9" strokeWidth="1.4" />
          <circle className="fill-success/18" cx="196" cy="32" r="6.5" />
          <path
            className="stroke-success"
            d="m192.6 32.1 2.2 2.2 4.4-4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
        </svg>
      );

    case "empty_memory":
      return (
        <svg aria-hidden="true" className={baseClass} fill="none" viewBox="0 0 220 132">
          <DotGridDefs id={patternId} />
          <rect fill={`url(#${patternId})`} height="114" rx="16" width="196" x="12" y="9" />
          <ellipse className="fill-guest/8" cx="92" cy="58" rx="44" ry="32" />
          <ellipse className="fill-info/8" cx="136" cy="70" rx="42" ry="30" />

          <path
            className="stroke-border"
            d="M84 44c12 0 14 10 22 14"
            strokeDasharray="3 3"
            strokeWidth="1.2"
          />
          <path
            className="stroke-border"
            d="M136 46c-12 0-14 10-22 14"
            strokeDasharray="3 3"
            strokeWidth="1.2"
          />

          <rect
            className="fill-card/90 stroke-border"
            height="42"
            rx="9"
            strokeWidth="1.1"
            width="62"
            x="22"
            y="20"
          />
          <path
            className="fill-guest/18 stroke-guest"
            d="m36 28 6.5 2.4v4.4c0 3.6-2.5 6.4-6.5 7.8-4-1.4-6.5-4.2-6.5-7.8v-4.4L36 28Z"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
          <rect
            className="fill-muted-foreground/38"
            height="3.2"
            rx="1.6"
            width="28"
            x="48"
            y="31"
          />
          <rect
            className="fill-muted-foreground/22"
            height="2.8"
            rx="1.4"
            width="22"
            x="48"
            y="38"
          />
          <rect className="fill-guest/25" height="3" rx="1.5" width="38" x="30" y="50" />

          <rect
            className="fill-card/90 stroke-border"
            height="42"
            rx="9"
            strokeWidth="1.1"
            width="62"
            x="136"
            y="24"
          />
          <circle className="fill-info/20 stroke-info" cx="150" cy="36" r="5.5" strokeWidth="1.2" />
          <circle className="fill-info" cx="150" cy="36" r="2" />
          <rect
            className="fill-muted-foreground/38"
            height="3.2"
            rx="1.6"
            width="26"
            x="160"
            y="33"
          />
          <rect
            className="fill-muted-foreground/22"
            height="2.8"
            rx="1.4"
            width="20"
            x="160"
            y="39.5"
          />
          <rect className="fill-info/28" height="3" rx="1.5" width="40" x="145" y="53" />

          <rect
            className="fill-foreground/[0.04] dark:fill-black/30"
            height="62"
            rx="12"
            width="92"
            x="66"
            y="53"
          />
          <rect
            className="fill-card stroke-primary/50"
            height="62"
            rx="12"
            strokeWidth="1.3"
            width="92"
            x="64"
            y="50"
          />

          <path
            className="stroke-primary/40"
            d="M86 74 110 66l24 10-24 14-24-16Z"
            strokeWidth="1.25"
          />
          <path className="stroke-primary/40" d="M110 66v24" strokeWidth="1.25" />

          <circle className="fill-info/22 stroke-info" cx="86" cy="74" r="4.8" strokeWidth="1.3" />
          <circle
            className="fill-primary/22 stroke-primary"
            cx="110"
            cy="66"
            r="5.8"
            strokeWidth="1.4"
          />
          <circle className="fill-primary" cx="110" cy="66" r="2.1" />
          <circle
            className="fill-guest/22 stroke-guest"
            cx="134"
            cy="76"
            r="4.8"
            strokeWidth="1.3"
          />
          <circle
            className="fill-success/22 stroke-success"
            cx="110"
            cy="90"
            r="4.4"
            strokeWidth="1.3"
          />

          <rect
            className="fill-muted-foreground/25"
            height="3"
            rx="1.5"
            width="28"
            x="78"
            y="101"
          />
          <rect className="fill-primary/30" height="3" rx="1.5" width="26" x="114" y="101" />
        </svg>
      );

    case "empty_triage":
      return (
        <svg aria-hidden="true" className={baseClass} fill="none" viewBox="0 0 220 132">
          <circle className="fill-success/8" cx="110" cy="66" r="46" />
          <circle
            className="stroke-border/60"
            cx="110"
            cy="66"
            r="48"
            strokeDasharray="3 4"
            strokeWidth="1"
          />
          <circle className="stroke-success/20" cx="110" cy="66" r="34" strokeWidth="1" />

          <rect
            className="fill-card/90 stroke-border/80"
            height="40"
            rx="9"
            strokeWidth="1.1"
            width="54"
            x="18"
            y="46"
          />
          <circle
            className="fill-success/20 stroke-success"
            cx="30"
            cy="59"
            r="4"
            strokeWidth="1.2"
          />
          <path
            className="stroke-success"
            d="m28.4 59.1 1.1 1.1 2.2-2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
          <rect
            className="fill-muted-foreground/32"
            height="3"
            rx="1.5"
            width="24"
            x="38"
            y="57.5"
          />
          <rect
            className="fill-muted-foreground/20"
            height="2.6"
            rx="1.3"
            width="34"
            x="26"
            y="70"
          />
          <rect className="fill-success/30" height="2.6" rx="1.3" width="20" x="26" y="76" />

          <rect
            className="fill-card/90 stroke-border/80"
            height="40"
            rx="9"
            strokeWidth="1.1"
            width="54"
            x="148"
            y="46"
          />
          <circle
            className="fill-success/20 stroke-success"
            cx="160"
            cy="59"
            r="4"
            strokeWidth="1.2"
          />
          <path
            className="stroke-success"
            d="m158.4 59.1 1.1 1.1 2.2-2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.2"
          />
          <rect
            className="fill-muted-foreground/32"
            height="3"
            rx="1.5"
            width="24"
            x="168"
            y="57.5"
          />
          <rect
            className="fill-muted-foreground/20"
            height="2.6"
            rx="1.3"
            width="34"
            x="156"
            y="70"
          />
          <rect className="fill-success/30" height="2.6" rx="1.3" width="20" x="156" y="76" />

          <rect
            className="fill-foreground/[0.04] dark:fill-black/30"
            height="78"
            rx="15"
            width="66"
            x="79"
            y="29"
          />
          <rect
            className="fill-card stroke-success/55"
            height="78"
            rx="15"
            strokeWidth="1.35"
            width="66"
            x="77"
            y="26"
          />
          <path
            className="fill-success/18 stroke-success"
            d="m110 38 17 6.4v12.8c0 10.6-7 18.8-17 22.8-10-4-17-12.2-17-22.8V44.4L110 38Z"
            strokeLinejoin="round"
            strokeWidth="1.6"
          />
          <path
            className="stroke-success"
            d="m103.2 59.2 4.6 4.6 9.4-9.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.1"
          />
          <rect className="fill-success/35" height="3.5" rx="1.75" width="24" x="98" y="89" />
          <rect
            className="fill-muted-foreground/25"
            height="2.6"
            rx="1.3"
            width="34"
            x="93"
            y="96"
          />
        </svg>
      );

    case "empty_prompts":
      return (
        <svg aria-hidden="true" className={baseClass} fill="none" viewBox="0 0 220 132">
          <DotGridDefs id={patternId} />
          <rect fill={`url(#${patternId})`} height="114" rx="16" width="196" x="12" y="9" />
          <ellipse className="fill-guest/8" cx="110" cy="64" rx="56" ry="38" />

          <rect
            className="fill-muted/45 stroke-border/65"
            height="84"
            rx="12"
            strokeWidth="1"
            width="134"
            x="48"
            y="25"
          />
          <rect
            className="fill-card stroke-border"
            height="86"
            rx="12"
            strokeWidth="1.2"
            width="136"
            x="38"
            y="18"
          />

          <circle className="fill-info/55" cx="51" cy="28" r="2.2" />
          <circle className="fill-guest/55" cx="59" cy="28" r="2.2" />
          <circle className="fill-success/55" cx="67" cy="28" r="2.2" />
          <rect
            className="fill-guest/15 stroke-guest/45"
            height="8"
            rx="4"
            strokeWidth="0.9"
            width="30"
            x="134"
            y="24"
          />
          <path className="stroke-border/75" d="M38 37h136" strokeWidth="1" />

          <rect
            className="fill-muted-foreground/25"
            height="2.6"
            rx="1.3"
            width="6"
            x="47"
            y="48"
          />
          <rect
            className="fill-muted-foreground/25"
            height="2.6"
            rx="1.3"
            width="6"
            x="47"
            y="61"
          />
          <rect
            className="fill-muted-foreground/25"
            height="2.6"
            rx="1.3"
            width="6"
            x="47"
            y="74"
          />
          <rect
            className="fill-muted-foreground/25"
            height="2.6"
            rx="1.3"
            width="6"
            x="47"
            y="87"
          />

          <path
            className="stroke-primary"
            d="m60 46.5 3.4 2.8-3.4 2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.4"
          />
          <rect className="fill-foreground/55" height="3.2" rx="1.6" width="42" x="68" y="47.7" />
          <rect
            className="fill-primary/18 stroke-primary/50"
            height="9"
            rx="4.5"
            strokeWidth="0.9"
            width="32"
            x="116"
            y="44.8"
          />

          <rect
            className="fill-muted-foreground/32"
            height="3.2"
            rx="1.6"
            width="24"
            x="60"
            y="60.7"
          />
          <rect
            className="fill-guest/18 stroke-guest/50"
            height="9"
            rx="4.5"
            strokeWidth="0.9"
            width="38"
            x="90"
            y="57.8"
          />
          <rect
            className="fill-muted-foreground/25"
            height="3.2"
            rx="1.6"
            width="22"
            x="134"
            y="60.7"
          />

          <rect
            className="fill-info/18 stroke-info/50"
            height="9"
            rx="4.5"
            strokeWidth="0.9"
            width="34"
            x="60"
            y="70.8"
          />
          <rect
            className="fill-muted-foreground/32"
            height="3.2"
            rx="1.6"
            width="54"
            x="100"
            y="73.7"
          />

          <rect
            className="fill-muted-foreground/25"
            height="3.2"
            rx="1.6"
            width="46"
            x="60"
            y="86.7"
          />
          <rect className="fill-primary/70" height="8" rx="1" width="2.2" x="110" y="84.3" />

          <rect
            className="fill-foreground/[0.04] dark:fill-black/30"
            height="30"
            rx="9"
            width="38"
            x="151"
            y="81"
          />
          <rect
            className="fill-card stroke-primary/55"
            height="30"
            rx="9"
            strokeWidth="1.25"
            width="38"
            x="149"
            y="78"
          />
          <rect className="fill-primary/12" height="20" rx="5.5" width="28" x="154" y="83" />
          <path
            className="stroke-primary"
            d="M164 87.8c-1.8 0-2.2.9-2.2 2.2v1.2c0 1-.6 1.8-1.6 1.8 1 0 1.6.8 1.6 1.8v1.2c0 1.3.4 2.2 2.2 2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.4"
          />
          <path
            className="stroke-primary"
            d="M172 87.8c1.8 0 2.2.9 2.2 2.2v1.2c0 1 .6 1.8 1.6 1.8-1 0-1.6.8-1.6 1.8v1.2c0 1.3-.4 2.2-2.2 2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.4"
          />
        </svg>
      );
  }
}
