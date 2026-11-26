import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type * as Cause from "effect/Cause";

export function formatCockpitCommandError(
  result: { readonly cause: Cause.Cause<unknown> },
  fallback: string,
): string {
  const err = squashAtomCommandFailure(result);
  if (err instanceof Error && err.message) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof err.message === "string" &&
    err.message.length > 0
  ) {
    return err.message;
  }
  return fallback;
}
