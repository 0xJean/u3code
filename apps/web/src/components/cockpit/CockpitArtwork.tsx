import type { ReactNode } from "react";
import { useId } from "react";

import connectHubArt from "~/assets/cockpit/connect-hub.webp";
import ganttShieldArt from "~/assets/cockpit/gantt-shield.webp";
import heroPipelineArt from "~/assets/cockpit/hero-pipeline.webp";
import promptMemoryArt from "~/assets/cockpit/prompt-memory.webp";
import releaseTrainArt from "~/assets/cockpit/release-train.webp";
import swarmBoardArt from "~/assets/cockpit/swarm-board.webp";
import workitemStudioArt from "~/assets/cockpit/workitem-studio.webp";
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

export type CockpitStudioArtKey =
  | "hero_pipeline"
  | "workitem_studio"
  | "connect_hub"
  | "swarm_board"
  | "release_train"
  | "prompt_memory"
  | "gantt_shield";

const STUDIO_ART_URLS: Record<CockpitStudioArtKey, string> = {
  hero_pipeline: heroPipelineArt,
  workitem_studio: workitemStudioArt,
  connect_hub: connectHubArt,
  swarm_board: swarmBoardArt,
  release_train: releaseTrainArt,
  prompt_memory: promptMemoryArt,
  gantt_shield: ganttShieldArt,
};

const STUDIO_ART_OBJECT_POSITION: Record<CockpitStudioArtKey, string> = {
  hero_pipeline: "object-[50%_46%]",
  workitem_studio: "object-center",
  connect_hub: "object-center",
  swarm_board: "object-center",
  release_train: "object-[50%_38%]",
  prompt_memory: "object-center",
  gantt_shield: "object-center",
};

const STUDIO_ART_TINT_CLASS: Record<CockpitStudioArtKey, string> = {
  hero_pipeline:
    "dark:from-primary dark:via-info/80 dark:to-guest/70 light:from-primary/70 light:via-info/50 light:to-guest/40",
  workitem_studio:
    "dark:from-primary dark:via-info/80 dark:to-guest/70 light:from-primary/70 light:via-info/50 light:to-guest/40",
  connect_hub:
    "dark:from-primary dark:via-info/80 dark:to-guest/70 light:from-primary/70 light:via-info/50 light:to-guest/40",
  swarm_board:
    "dark:from-primary dark:via-info/80 dark:to-guest/70 light:from-primary/70 light:via-info/50 light:to-guest/40",
  prompt_memory:
    "dark:from-primary dark:via-info/80 dark:to-guest/70 light:from-primary/70 light:via-info/50 light:to-guest/40",
  release_train:
    "dark:from-success dark:via-primary/85 dark:to-info/75 light:from-success/65 light:via-primary/60 light:to-info/50",
  gantt_shield:
    "dark:from-success dark:via-primary/85 dark:to-info/75 light:from-success/65 light:via-primary/60 light:to-info/50",
};

const STUDIO_ART_GLOW_CLASS: Record<CockpitStudioArtKey, string> = {
  hero_pipeline: "bg-radial from-primary/14 via-info/6 to-transparent dark:from-primary/18",
  workitem_studio: "bg-radial from-primary/14 via-info/6 to-transparent dark:from-primary/18",
  connect_hub: "bg-radial from-primary/14 via-info/6 to-transparent dark:from-primary/18",
  swarm_board: "bg-radial from-primary/14 via-info/6 to-transparent dark:from-primary/18",
  prompt_memory: "bg-radial from-primary/14 via-info/6 to-transparent dark:from-primary/18",
  release_train: "bg-radial from-success/14 via-primary/6 to-transparent dark:from-success/18",
  gantt_shield: "bg-radial from-success/14 via-primary/6 to-transparent dark:from-success/18",
};

const ILLUSTRATION_ART_KEY: Record<CockpitIllustrationKind, CockpitStudioArtKey> = {
  connect_hub: "connect_hub",
  empty_work_items: "hero_pipeline",
  delivery_banner: "hero_pipeline",
  empty_gantt: "gantt_shield",
  empty_triage: "gantt_shield",
  empty_board: "swarm_board",
  empty_releases: "release_train",
  empty_memory: "prompt_memory",
  empty_prompts: "prompt_memory",
};

const DUOTONE_ICON_STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 1.7,
} as const;

function IconDuotoneDefs({
  fillId,
  accentId,
}: {
  readonly fillId: string;
  readonly accentId: string;
}) {
  return (
    <defs>
      <linearGradient id={fillId} x1="0%" x2="100%" y1="0%" y2="100%">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0.42" />
        <stop offset="55%" stopColor="currentColor" stopOpacity="0.2" />
        <stop offset="100%" stopColor="currentColor" stopOpacity="0.08" />
      </linearGradient>
      <linearGradient id={accentId} x1="0%" x2="100%" y1="0%" y2="100%">
        <stop offset="0%" stopColor="currentColor" stopOpacity="0.58" />
        <stop offset="100%" stopColor="currentColor" stopOpacity="0.14" />
      </linearGradient>
    </defs>
  );
}

function BranchArtGeometry({
  fillUrl,
  accentUrl,
}: {
  readonly fillUrl: string;
  readonly accentUrl: string;
}) {
  return (
    <>
      <circle cx="17" cy="6.4" fill={accentUrl} fillOpacity="0.45" r="4.3" stroke="none" />
      <circle cx="7" cy="5.6" fill={fillUrl} r="2.2" />
      <circle cx="7" cy="18.4" fill={fillUrl} r="2.2" />
      <circle cx="17" cy="6.4" fill={accentUrl} r="2.4" />
      <circle cx="17" cy="6.4" fill="currentColor" r="0.9" stroke="none" />
      <path d="M7 7.8v8.4" />
      <path d="M7 16.2c0-2.9 2.1-4.4 5-4.4h2a3 3 0 0 0 3-3" />
      <path d="M11.6 11.8h1.8" strokeOpacity="0.6" strokeWidth="1.25" />
    </>
  );
}

function PrototypeArtGeometry({
  fillUrl,
  accentUrl,
}: {
  readonly fillUrl: string;
  readonly accentUrl: string;
}) {
  return (
    <>
      <path
        d="M5.5 3.8h13A2.5 2.5 0 0 1 21 6.3v6.2l-6.8 5.3H5.5A2.5 2.5 0 0 1 3 15.3V6.3a2.5 2.5 0 0 1 2.5-2.5Z"
        fill={fillUrl}
        stroke="none"
      />
      <path
        d="M5.5 3.8h13A2.5 2.5 0 0 1 21 6.3v1.5H3V6.3a2.5 2.5 0 0 1 2.5-2.5Z"
        fill={accentUrl}
        stroke="none"
      />
      <rect fill={accentUrl} height="5.2" rx="1.15" strokeWidth="1.3" width="5" x="5.4" y="9.9" />
      <path d="M12.2 17.8H5.5A2.5 2.5 0 0 1 3 15.3V6.3A2.5 2.5 0 0 1 5.5 3.8h13A2.5 2.5 0 0 1 21 6.3v6.2" />
      <path d="M3 7.8h18" strokeWidth="1.35" />
      <circle cx="5.6" cy="5.8" fill="currentColor" r="0.7" stroke="none" />
      <circle cx="7.9" cy="5.8" fill="currentColor" r="0.7" stroke="none" />
      <path d="M12.7 10.6h5.5" strokeWidth="1.35" />
      <path d="M12.7 13h2.3" strokeOpacity="0.65" strokeWidth="1.2" />
      <path d="M14.2 13.6 20.3 16l-2.5.9-.9 2.5-2.7-5.8Z" fill={accentUrl} strokeWidth="1.55" />
    </>
  );
}

function GovernanceArtGeometry({
  fillUrl,
  accentUrl,
}: {
  readonly fillUrl: string;
  readonly accentUrl: string;
}) {
  return (
    <>
      <path
        d="M12 3.2 19.2 5.8v5.6c0 4.5-3 8-7.2 9.6-4.2-1.6-7.2-5.1-7.2-9.6V5.8L12 3.2Z"
        fill={fillUrl}
        stroke="none"
      />
      <path d="M12 3.2 4.8 5.8v4.8H12V3.2Z" fill={accentUrl} stroke="none" />
      <path
        d="M12 10.6h7.2v.8c0 4.5-3 8-7.2 9.6V10.6Z"
        fill={accentUrl}
        fillOpacity="0.6"
        stroke="none"
      />
      <path d="M12 3.2 19.2 5.8v5.6c0 4.5-3 8-7.2 9.6-4.2-1.6-7.2-5.1-7.2-9.6V5.8L12 3.2Z" />
      <path d="M12 3.8v16.6" strokeOpacity="0.75" strokeWidth="1.3" />
      <path d="M5.2 10.6h13.6" strokeOpacity="0.75" strokeWidth="1.3" />
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
  const uid = useId().replaceAll(":", "");
  const fillId = `${uid}-sf`;
  const accentId = `${uid}-sa`;
  const fillUrl = `url(#${fillId})`;
  const accentUrl = `url(#${accentId})`;
  const iconClass = cn("size-4 shrink-0", className);

  switch (stage) {
    case "intake":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <path
            d="M3.5 13.4h4.3l1.5 2.2h5.4l1.5-2.2h4.3v4.4a2.7 2.7 0 0 1-2.7 2.7H6.2a2.7 2.7 0 0 1-2.7-2.7v-4.4Z"
            fill={fillUrl}
          />
          <path d="M9.4 8.2h5.2L12 11 9.4 8.2Z" fill={accentUrl} stroke="none" />
          <path d="M3.5 13.4 5.2 7A2.2 2.2 0 0 1 7.3 5.3h9.4A2.2 2.2 0 0 1 18.8 7l1.7 6.4" />
          <path d="M6.8 18h10.4" strokeOpacity="0.55" strokeWidth="1.2" />
          <path d="M12 3.2v7.6" />
          <path d="m9.2 8.2 2.8 2.8 2.8-2.8" />
        </svg>
      );
    case "prd":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <path
            d="M4.5 5.8A2.3 2.3 0 0 1 6.8 3.5h5.8l4.9 4.9v3.9a4.8 4.8 0 0 0-3.8 8.2H6.8a2.3 2.3 0 0 1-2.3-2.3V5.8Z"
            fill={fillUrl}
            stroke="none"
          />
          <path
            d="M12.6 3.5v3.4a1.5 1.5 0 0 0 1.5 1.5h3.4l-4.9-4.9Z"
            fill={accentUrl}
            stroke="none"
          />
          <path d="M11.8 20.5h-5a2.3 2.3 0 0 1-2.3-2.3V5.8A2.3 2.3 0 0 1 6.8 3.5h5.8l4.9 4.9v3.4" />
          <path d="M12.6 3.5v3.4a1.5 1.5 0 0 0 1.5 1.5h3.4" strokeWidth="1.35" />
          <path d="M7.8 10.7h6.2" strokeWidth="1.35" />
          <path d="M7.8 13.8h4" strokeOpacity="0.75" strokeWidth="1.35" />
          <path d="M7.8 16.8h2.6" strokeOpacity="0.6" strokeWidth="1.35" />
          <circle cx="17.1" cy="17.1" fill={accentUrl} r="3.6" />
          <path d="m15.6 17.1 1 1 2.1-2.2" strokeWidth="1.5" />
        </svg>
      );
    case "prototype":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <PrototypeArtGeometry accentUrl={accentUrl} fillUrl={fillUrl} />
        </svg>
      );
    case "issue":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <circle cx="12" cy="12" fill={fillUrl} r="8.4" />
          <circle
            cx="12"
            cy="12"
            fill={accentUrl}
            r="4.8"
            strokeOpacity="0.45"
            strokeWidth="1.15"
          />
          <circle cx="12" cy="12" fill="currentColor" r="2.1" stroke="none" />
          <path d="M12 3.6v2.3" strokeWidth="1.5" />
          <path d="M12 18.1v2.3" strokeWidth="1.5" />
          <path d="M3.6 12h2.3" strokeWidth="1.5" />
          <path d="M18.1 12h2.3" strokeWidth="1.5" />
        </svg>
      );
    case "dev":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <BranchArtGeometry accentUrl={accentUrl} fillUrl={fillUrl} />
        </svg>
      );
    case "pr":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <circle cx="6.8" cy="5.5" fill={fillUrl} r="2.2" />
          <circle cx="6.8" cy="18.5" fill={fillUrl} r="2.2" />
          <circle cx="17.2" cy="18.5" fill={accentUrl} r="2.3" />
          <circle cx="17.2" cy="18.5" fill="currentColor" r="0.85" stroke="none" />
          <path d="M6.8 7.7v8.6" />
          <path d="M17.2 16.2v-4a4.4 4.4 0 0 0-4.4-4.4h-1.6" />
          <path d="m13.3 5.6-2.3 2.2 2.3 2.2" />
        </svg>
      );
    case "review":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <circle cx="10.8" cy="10.8" fill={fillUrl} r="6.7" />
          <path d="M6.8 8.3a4.7 4.7 0 0 1 4.2-2.2" strokeOpacity="0.6" strokeWidth="1.2" />
          <path d="m8 10.9 1.9 1.9 3.7-3.8" />
          <path d="m15.7 15.7 4.4 4.4" strokeWidth="1.95" />
        </svg>
      );
    case "release":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <path d="M12 8.2 18.6 11.6 12 15l-6.6-3.4L12 8.2Z" fill={accentUrl} stroke="none" />
          <path d="M5.4 11.6 12 15v5.6l-6.6-3.4v-5.6Z" fill={fillUrl} stroke="none" />
          <path
            d="M18.6 11.6 12 15v5.6l6.6-3.4v-5.6Z"
            fill={fillUrl}
            fillOpacity="0.45"
            stroke="none"
          />
          <path d="M12 8.2 18.6 11.6v5.6L12 20.6l-6.6-3.4v-5.6L12 8.2Z" />
          <path d="M5.4 11.6 12 15l6.6-3.4" strokeWidth="1.35" />
          <path d="M12 15v5.6" strokeWidth="1.35" />
          <path d="M12 7.8V3.2" />
          <path d="M9.4 5.5 12 3l2.6 2.5" />
        </svg>
      );
    case "governance":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <GovernanceArtGeometry accentUrl={accentUrl} fillUrl={fillUrl} />
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
  const uid = useId().replaceAll(":", "");
  const fillId = `${uid}-af`;
  const accentId = `${uid}-aa`;
  const fillUrl = `url(#${fillId})`;
  const accentUrl = `url(#${accentId})`;
  const iconClass = cn("size-4 shrink-0", className);

  switch (kind) {
    case "branch":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <BranchArtGeometry accentUrl={accentUrl} fillUrl={fillUrl} />
        </svg>
      );
    case "github_issue":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <circle cx="12" cy="12" fill={fillUrl} r="8.2" stroke="none" />
          <path d="M19.8 9.4A8.2 8.2 0 1 1 14.6 4.2" />
          <circle cx="12" cy="12" fill="currentColor" r="2.3" stroke="none" />
          <circle cx="17.8" cy="6.2" fill={accentUrl} r="2.2" />
        </svg>
      );
    case "prototype":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <PrototypeArtGeometry accentUrl={accentUrl} fillUrl={fillUrl} />
        </svg>
      );
    case "labels":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <path
            d="M3.8 6a2.2 2.2 0 0 1 2.2-2.2h4a2.2 2.2 0 0 1 1.56.64l5.5 5.5a2 2 0 0 1 0 2.82l-4 4a2 2 0 0 1-2.82 0l-5.5-5.5a2.2 2.2 0 0 1-.64-1.56V6Z"
            fill={fillUrl}
          />
          <circle cx="7.6" cy="7.6" fill="currentColor" r="1.2" stroke="none" />
          <path d="M9.6 10.6 13.4 14.4" strokeOpacity="0.55" strokeWidth="1.25" />
          <path d="M14.2 19.6a2 2 0 0 0 2.82 0l2.9-2.9a2 2 0 0 0 0-2.82l-4.2-4.2" />
        </svg>
      );
    case "prompt_template":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <rect fill={fillUrl} height="15.6" rx="2.8" width="17" x="3.5" y="4.2" />
          <path d="m7.2 9.4 2.2 2.1-2.2 2.1" />
          <path d="M11.6 10h5.4" strokeWidth="1.4" />
          <path d="M11.6 13.3h3.6" strokeOpacity="0.75" strokeWidth="1.4" />
          <path d="M7.2 16.5h6.6" strokeOpacity="0.6" strokeWidth="1.35" />
          <rect fill={accentUrl} height="1.8" rx="0.9" stroke="none" width="3.8" x="13.8" y="6.2" />
        </svg>
      );
    case "governance":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <GovernanceArtGeometry accentUrl={accentUrl} fillUrl={fillUrl} />
        </svg>
      );
    case "feature":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <path d="M12 3.2 20.4 12 12 20.8 3.6 12 12 3.2Z" fill={fillUrl} />
          <path d="M12 7.4 16.4 12 12 16.6 7.6 12 12 7.4Z" fill={accentUrl} strokeWidth="1.35" />
          <path d="M12 3.4v4" strokeOpacity="0.7" strokeWidth="1.25" />
          <path d="M12 16.6v4" strokeOpacity="0.7" strokeWidth="1.25" />
          <path d="M3.8 12h3.8" strokeOpacity="0.6" strokeWidth="1.25" />
          <path d="M16.4 12h3.8" strokeOpacity="0.6" strokeWidth="1.25" />
        </svg>
      );
    case "bug":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <path d="M9.1 8.4a2.9 2.9 0 0 1 5.8 0" fill={accentUrl} />
          <rect fill={fillUrl} height="11.2" rx="4.6" width="9.2" x="7.4" y="8.2" />
          <path d="M12 10.6v8.6" strokeOpacity="0.75" strokeWidth="1.3" />
          <path d="M9.6 5.9 8.1 3.8" strokeWidth="1.55" />
          <path d="m14.4 5.9 1.5-2.1" strokeWidth="1.55" />
          <path d="M7.4 10.9H4.4" strokeWidth="1.55" />
          <path d="M7.2 14H4.2" strokeWidth="1.55" />
          <path d="m7.9 17.2-2.4 1.3" strokeWidth="1.55" />
          <path d="M16.6 10.9h3" strokeWidth="1.55" />
          <path d="M16.8 14h3" strokeWidth="1.55" />
          <path d="m16.1 17.2 2.4 1.3" strokeWidth="1.55" />
        </svg>
      );
    case "refactor":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <circle cx="12" cy="12" fill={fillUrl} fillOpacity="0.55" r="7" stroke="none" />
          <rect
            fill={accentUrl}
            height="5.2"
            rx="1.35"
            strokeWidth="1.35"
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
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <path
            d="M15.4 5.1a4.4 4.4 0 0 0-4.8 6.1L5 16.8A1.56 1.56 0 0 0 7.2 19l5.6-5.6a4.4 4.4 0 0 0 6.1-4.8l-2 2-3.5-3.5 2-2Z"
            fill={fillUrl}
          />
          <path d="m8.2 15.8 3.6-3.6" strokeOpacity="0.6" strokeWidth="1.2" />
          <circle cx="6.2" cy="17.8" fill="currentColor" r="0.85" stroke="none" />
        </svg>
      );
    case "security":
      return (
        <svg aria-hidden="true" className={iconClass} viewBox="0 0 24 24" {...DUOTONE_ICON_STROKE}>
          <IconDuotoneDefs accentId={accentId} fillId={fillId} />
          <path
            d="M12 3.2 19.2 5.8v5.5c0 4.6-3 8.1-7.2 9.7-4.2-1.6-7.2-5.1-7.2-9.7V5.8L12 3.2Z"
            fill={fillUrl}
          />
          <rect
            fill={accentUrl}
            height="4.8"
            rx="1.2"
            strokeWidth="1.4"
            width="6.4"
            x="8.8"
            y="11"
          />
          <path d="M10.2 11V9.3a1.8 1.8 0 0 1 3.6 0V11" strokeWidth="1.4" />
          <circle cx="12" cy="13.4" fill="currentColor" r="0.75" stroke="none" />
        </svg>
      );
  }
}

function CockpitThemedArtMedia({
  art,
  objectPositionClass = "object-center",
  className,
}: {
  readonly art: CockpitStudioArtKey;
  readonly objectPositionClass?: string;
  readonly className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative isolate h-full w-full overflow-hidden dark:mix-blend-screen light:mix-blend-multiply light:opacity-85",
        className,
      )}
    >
      <img
        alt=""
        aria-hidden
        className={cn(
          "h-full w-full object-cover dark:grayscale dark:contrast-125 dark:brightness-95 light:grayscale light:invert light:contrast-125 light:brightness-105",
          objectPositionClass,
        )}
        decoding="async"
        loading="eager"
        src={STUDIO_ART_URLS[art]}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-linear-to-tr dark:mix-blend-color light:mix-blend-screen",
          STUDIO_ART_TINT_CLASS[art],
        )}
      />
    </div>
  );
}

export function CockpitStudioBanner({
  art,
  eyebrow,
  title,
  description,
  meta,
  actions,
  compact = false,
  className,
}: {
  readonly art: CockpitStudioArtKey;
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly meta?: ReactNode;
  readonly actions?: ReactNode;
  readonly compact?: boolean;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border border-border/65 bg-card shadow-sm ring-1 ring-inset ring-foreground/5",
        compact ? "min-h-24 px-4 py-3.5 sm:px-5 sm:py-4" : "min-h-36 px-5 py-5 sm:px-6 sm:py-5",
        className,
      )}
      data-slot="cockpit-studio-banner"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-full sm:w-[62%] lg:w-[58%]"
      >
        <div className={cn("absolute inset-0", STUDIO_ART_GLOW_CLASS[art])} />
        <CockpitThemedArtMedia art={art} objectPositionClass={STUDIO_ART_OBJECT_POSITION[art]} />
        <div className="absolute inset-0 bg-linear-to-r from-card via-card/85 via-35% to-transparent max-sm:via-card/90 max-sm:via-58% max-sm:to-card/35" />
        <div className="absolute inset-0 bg-linear-to-t from-card/55 via-transparent to-card/15" />
      </div>

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-linear-to-r from-transparent via-foreground/12 to-transparent"
      />

      <div
        className={cn(
          "relative z-10 flex flex-col justify-between sm:max-w-[60%] lg:max-w-[56%]",
          compact ? "gap-2.5" : "gap-3",
        )}
      >
        <div className={compact ? "space-y-1" : "space-y-1.5"}>
          {eyebrow ? (
            <div className="flex flex-wrap items-center gap-2 text-2xs font-medium text-muted-foreground">
              {eyebrow}
            </div>
          ) : null}
          <h2
            className={cn(
              "font-semibold tracking-tight text-foreground text-balance",
              compact ? "text-sm sm:text-base" : "text-base sm:text-lg",
            )}
          >
            {title}
          </h2>
          {description ? (
            <div
              className={cn(
                "leading-relaxed text-muted-foreground text-pretty",
                compact ? "text-xs" : "text-xs sm:text-sm",
              )}
            >
              {description}
            </div>
          ) : null}
        </div>

        {meta || actions ? (
          <div className="flex flex-col gap-2">
            {meta ? (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {meta}
              </div>
            ) : null}
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CockpitIllustration({
  kind,
  className,
}: {
  readonly kind: CockpitIllustrationKind;
  readonly className?: string;
}) {
  const artKey = ILLUSTRATION_ART_KEY[kind];
  const isWide = kind === "connect_hub" || kind === "delivery_banner";

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative isolate aspect-16/9 w-full shrink-0 overflow-hidden rounded-2xl border border-border/65 bg-card shadow-md ring-1 ring-inset ring-foreground/6",
        isWide ? "max-w-96" : "max-w-80",
        className,
      )}
      data-slot="cockpit-illustration"
    >
      <div className={cn("pointer-events-none absolute inset-0", STUDIO_ART_GLOW_CLASS[artKey])} />
      <CockpitThemedArtMedia art={artKey} />
      <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-card/30 via-transparent to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-foreground/15 to-transparent" />
      <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-foreground/6" />
    </div>
  );
}
