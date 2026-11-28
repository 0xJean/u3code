import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { Separator } from "~/components/ui/separator";
import { cn } from "~/lib/utils";

export type CockpitTone = "neutral" | "success" | "info" | "warning" | "error";

export type CockpitIconBadgeTone =
  | "neutral"
  | "primary"
  | "success"
  | "info"
  | "warning"
  | "error"
  | "violet";

const ICON_BADGE_TONE_CLASS: Record<CockpitIconBadgeTone, string> = {
  neutral: "border-border/60 bg-muted/50 text-muted-foreground",
  primary: "border-primary/20 bg-primary/10 text-primary",
  success: "border-success/20 bg-success/10 text-success-foreground",
  info: "border-info/20 bg-info/10 text-info-foreground",
  warning: "border-warning/20 bg-warning/10 text-warning-foreground",
  error: "border-destructive/20 bg-destructive/10 text-destructive",
  violet: "border-guest/25 bg-guest/12 text-guest-foreground",
};

const ICON_BADGE_SIZE_CLASS = {
  sm: "size-6 rounded-md [&_svg]:size-3.5",
  md: "size-7 rounded-lg [&_svg]:size-4",
  lg: "size-9 rounded-xl [&_svg]:size-5",
} as const;

export function CockpitIconBadge({
  tone = "neutral",
  size = "md",
  className,
  children,
}: {
  readonly tone?: CockpitIconBadgeTone;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center border shadow-2xs",
        ICON_BADGE_TONE_CLASS[tone],
        ICON_BADGE_SIZE_CLASS[size],
        className,
      )}
      data-slot="cockpit-icon-badge"
    >
      {children}
    </span>
  );
}

const DOT_TONE_CLASS: Record<CockpitTone, string> = {
  neutral: "bg-muted-foreground/45",
  success: "bg-success",
  info: "bg-info",
  warning: "bg-warning",
  error: "bg-destructive",
};

const TEXT_TONE_CLASS: Record<CockpitTone, string> = {
  neutral: "text-foreground",
  success: "text-success-foreground",
  info: "text-info-foreground",
  warning: "text-warning-foreground",
  error: "text-destructive",
};

export function CockpitStatusDot({
  tone = "neutral",
  ring = false,
  className,
}: {
  readonly tone?: CockpitTone;
  readonly ring?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        DOT_TONE_CLASS[tone],
        ring && tone === "success" && "ring-2 ring-success/25",
        ring && tone === "error" && "ring-2 ring-destructive/25",
        ring && tone === "warning" && "ring-2 ring-warning/25",
        ring && tone === "info" && "ring-2 ring-info/25",
        className,
      )}
    />
  );
}

export function CockpitSectionHeader({
  title,
  icon,
  count,
  action,
  className,
}: {
  readonly title: ReactNode;
  readonly icon?: ReactNode;
  readonly count?: number | string | undefined;
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-7 items-center gap-2 px-0.5 pb-1.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {icon ? (
        <span aria-hidden className="inline-flex shrink-0 items-center [&_svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      <h2 className="shrink-0 text-xs font-medium text-muted-foreground">{title}</h2>
      {count !== undefined ? (
        <span className="shrink-0 tabular-nums text-muted-foreground/60">{count}</span>
      ) : null}
      <Separator className="min-w-2 flex-1" />
      {action ? <div className="flex shrink-0 items-center gap-1.5">{action}</div> : null}
    </div>
  );
}

const SURFACE_VARIANT_CLASS = {
  grouped: "rounded-xl border border-border/55 bg-card/35 shadow-xs/5",
  subtle: "rounded-xl border border-border/45 bg-muted/15",
  card: "rounded-lg border border-border/55 bg-background/95 shadow-2xs",
} as const;

const SURFACE_PADDING_CLASS = {
  none: "",
  sm: "p-3.5",
  md: "p-4",
  lg: "p-5",
} as const;

export function CockpitSurface({
  variant = "grouped",
  divided = false,
  padding = "none",
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  readonly variant?: keyof typeof SURFACE_VARIANT_CLASS;
  readonly divided?: boolean;
  readonly padding?: keyof typeof SURFACE_PADDING_CLASS;
}) {
  return (
    <div
      data-slot="cockpit-surface"
      {...props}
      className={cn(
        SURFACE_VARIANT_CLASS[variant],
        SURFACE_PADDING_CLASS[padding],
        divided && "divide-y divide-border/50 overflow-hidden",
        className,
      )}
    />
  );
}

export function CockpitSurfaceRow({
  interactive = false,
  selected = false,
  density = "default",
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  readonly interactive?: boolean;
  readonly selected?: boolean;
  readonly density?: "default" | "compact";
}) {
  return (
    <div
      data-slot="cockpit-surface-row"
      {...props}
      className={cn(
        density === "compact" ? "px-3.5 py-2.5" : "px-4 py-3",
        selected
          ? "bg-accent/65"
          : interactive
            ? "transition-colors hover:bg-accent/35"
            : undefined,
        className,
      )}
    />
  );
}

export function CockpitStatPill({
  label,
  value,
  tone = "neutral",
  active = false,
  onClick,
  className,
}: {
  readonly label: ReactNode;
  readonly value: number;
  readonly tone?: CockpitTone;
  readonly active?: boolean;
  readonly onClick?: (() => void) | undefined;
  readonly className?: string;
}) {
  const effectiveTone: CockpitTone = value > 0 ? tone : "neutral";
  const sharedClass = cn(
    "inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
    active
      ? "border-border bg-accent text-foreground"
      : "border-border/45 bg-muted/25 text-muted-foreground",
    onClick && "cursor-pointer hover:border-border/75 hover:bg-accent/55 hover:text-foreground",
    className,
  );

  const content = (
    <>
      <CockpitStatusDot tone={effectiveTone} />
      <span className="whitespace-nowrap">{label}</span>
      <span
        className={cn(
          "font-mono text-2xs font-semibold tabular-nums",
          value > 0 ? TEXT_TONE_CLASS[effectiveTone] : "text-muted-foreground/75",
        )}
      >
        {value}
      </span>
    </>
  );

  if (onClick) {
    return (
      <button
        aria-pressed={active}
        className={cn(
          sharedClass,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        type="button"
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <span className={sharedClass}>{content}</span>;
}

export function CockpitPriorityDot({
  priority,
  showLabel = true,
  className,
}: {
  readonly priority: string;
  readonly showLabel?: boolean;
  readonly className?: string;
}) {
  const normalized = priority.toLowerCase();
  const tone: CockpitTone =
    normalized === "p0"
      ? "error"
      : normalized === "p1"
        ? "warning"
        : normalized === "p2"
          ? "info"
          : "neutral";
  const textClass =
    normalized === "p0"
      ? "text-destructive"
      : normalized === "p1"
        ? "text-warning-foreground"
        : "text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-mono text-2xs font-medium uppercase tabular-nums",
        textClass,
        className,
      )}
    >
      <CockpitStatusDot tone={tone} />
      {showLabel ? <span>{priority.toUpperCase()}</span> : null}
    </span>
  );
}

export function CockpitHealthDot({
  health,
  label,
  className,
}: {
  readonly health: string;
  readonly label?: ReactNode;
  readonly className?: string;
}) {
  const tone: CockpitTone =
    health === "blocked" ? "error" : health === "at_risk" ? "warning" : "success";
  const textClass =
    health === "blocked"
      ? "text-destructive"
      : health === "at_risk"
        ? "text-warning-foreground"
        : "text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-2xs font-medium",
        textClass,
        className,
      )}
    >
      <CockpitStatusDot tone={tone} />
      {label ? <span>{label}</span> : null}
    </span>
  );
}

export function CockpitFieldLabel({ className, ...props }: ComponentPropsWithoutRef<"label">) {
  return (
    <label
      {...props}
      className={cn("mb-1.5 block text-xs font-medium text-muted-foreground", className)}
    />
  );
}

export function CockpitInlineAlert({
  tone = "error",
  className,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  readonly tone?: "error" | "warning" | "info";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      {...props}
      className={cn(
        "rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed",
        tone === "error" && "border-destructive/30 bg-destructive/8 text-destructive",
        tone === "warning" && "border-warning/30 bg-warning/8 text-warning-foreground",
        tone === "info" && "border-info/30 bg-info/8 text-info-foreground",
        className,
      )}
    />
  );
}

export function CockpitDiffStat({
  additions,
  deletions,
  className,
}: {
  readonly additions: number;
  readonly deletions: number;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 font-mono text-2xs tabular-nums",
        className,
      )}
    >
      <span className="text-diff-addition-foreground">+{additions}</span>
      <span className="text-diff-deletion-foreground">-{deletions}</span>
    </span>
  );
}

export function CockpitUnderlineTabs({
  label,
  className,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <div
      aria-label={label}
      className={cn("-mb-px flex min-w-0 items-center gap-5 overflow-x-auto", className)}
      data-slot="cockpit-underline-tabs"
      role="tablist"
    >
      {children}
    </div>
  );
}

export function CockpitUnderlineTab({
  active,
  count,
  icon,
  children,
  onClick,
  className,
}: {
  readonly active: boolean;
  readonly count?: number | string | undefined;
  readonly icon?: ReactNode;
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly className?: string;
}) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 py-2.5 text-sm whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        active
          ? "border-foreground font-medium text-foreground"
          : "border-transparent font-normal text-muted-foreground hover:text-foreground",
        className,
      )}
      data-slot="cockpit-underline-tab"
      role="tab"
      type="button"
      onClick={onClick}
    >
      {icon ? (
        <span aria-hidden className="inline-flex shrink-0 items-center [&_svg]:size-3.5">
          {icon}
        </span>
      ) : null}
      <span>{children}</span>
      {count !== undefined ? (
        <span
          className={cn(
            "font-mono text-2xs tabular-nums",
            active ? "text-foreground/65" : "text-muted-foreground/65",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
