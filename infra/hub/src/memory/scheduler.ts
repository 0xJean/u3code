import { eq } from "drizzle-orm";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import { projects } from "../db/schema.ts";
import type { NotificationDispatcher } from "../notifiers/index.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";
import { createOpenAiCompatibleSynthesizer, generateAndPersistDigest } from "./engine.ts";

export interface ScheduleSlot {
  readonly hour: number;
  readonly minute: number;
  readonly label: string;
}

export function parseScheduleSlots(times: ReadonlyArray<string>): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  for (const raw of times) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
    if (!match) continue;
    const hour = Number.parseInt(match[1]!, 10);
    const minute = Number.parseInt(match[2]!, 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
    const label = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    if (!slots.some((s) => s.label === label)) {
      slots.push({ hour, minute, label });
    }
  }
  return slots;
}

/**
 * Resolves whether `now` falls on a scheduled HH:MM slot in the configured fixed UTC offset.
 * Returns a unique slot key (`YYYY-MM-DD@HH:MM`) when due, or `null` otherwise.
 */
export function resolveDueSlotKey(
  nowMs: number,
  timezoneOffsetMinutes: number,
  slots: ReadonlyArray<ScheduleSlot>,
): string | null {
  if (slots.length === 0) return null;
  const shifted = new Date(nowMs + timezoneOffsetMinutes * 60_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();

  const matched = slots.find((slot) => slot.hour === hour && slot.minute === minute);
  if (!matched) return null;
  return `${year}-${month}-${day}@${matched.label}`;
}

export class DigestScheduler {
  readonly #db: HubDatabase;
  readonly #config: HubConfig;
  readonly #broker: HubSocketBroker;
  readonly #notifier: NotificationDispatcher;
  readonly #slots: readonly ScheduleSlot[];
  readonly #firedKeys = new Set<string>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: {
    readonly db: HubDatabase;
    readonly config: HubConfig;
    readonly broker: HubSocketBroker;
    readonly notifier: NotificationDispatcher;
  }) {
    this.#db = deps.db;
    this.#config = deps.config;
    this.#broker = deps.broker;
    this.#notifier = deps.notifier;
    this.#slots = parseScheduleSlots(deps.config.digestScheduleTimes);
  }

  get slots(): readonly ScheduleSlot[] {
    return this.#slots;
  }

  async runTick(nowMs: number = Date.now()): Promise<{ readonly triggeredCount: number }> {
    const slotKey = resolveDueSlotKey(nowMs, this.#config.digestTimezoneOffsetMinutes, this.#slots);
    if (!slotKey) return { triggeredCount: 0 };

    const activeProjects = await this.#db
      .select()
      .from(projects)
      .where(eq(projects.status, "active"));

    const synthesizer = createOpenAiCompatibleSynthesizer(this.#config);
    let triggeredCount = 0;

    for (const project of activeProjects) {
      const dedupeKey = `${project.id}:${slotKey}`;
      if (this.#firedKeys.has(dedupeKey)) continue;
      this.#firedKeys.add(dedupeKey);

      try {
        await generateAndPersistDigest(
          {
            db: this.#db,
            broker: this.#broker,
            notifier: this.#notifier,
            synthesizer,
          },
          {
            workspaceId: project.workspaceId,
            projectId: project.id,
            triggerType: "scheduled",
            periodHours: 24,
          },
        );
        triggeredCount += 1;
      } catch (error) {
        console.error(`Scheduled digest failed for project ${project.id}:`, error);
      }
    }

    // Cap dedupe set memory over long-running hub uptime.
    if (this.#firedKeys.size > 2000) {
      this.#firedKeys.clear();
    }
    return { triggeredCount };
  }

  start(): void {
    if (this.#slots.length === 0 || this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.runTick();
    }, 30_000);
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }
}
