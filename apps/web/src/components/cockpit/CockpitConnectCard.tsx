import type { EnvironmentId, TeamHubStatusResult } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ExternalLinkIcon, KeyRoundIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import { CockpitIllustration, CockpitStageArtworkIcon } from "./CockpitArtwork";
import {
  CockpitFieldLabel,
  CockpitIconBadge,
  CockpitInlineAlert,
  CockpitSurface,
} from "./CockpitPrimitives";
import { formatCockpitCommandError } from "./cockpitError";

interface CockpitConnectCardProps {
  readonly environmentId: EnvironmentId;
  readonly initialHubUrl?: string | null | undefined;
  readonly onConnected: (status: TeamHubStatusResult) => void;
}

export function CockpitConnectCard({
  environmentId,
  initialHubUrl,
  onConnected,
}: CockpitConnectCardProps) {
  const gt = useGT();
  const [mode, setMode] = useState<"local" | "tokens">("local");
  const [hubUrl, setHubUrl] = useState(initialHubUrl ?? "http://127.0.0.1:4310");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const connectLocal = useAtomCommand(teamHubEnvironment.connectLocal, { reportFailure: false });
  const connectTokens = useAtomCommand(teamHubEnvironment.connectTokens, { reportFailure: false });

  const normalizedHubUrl = hubUrl.trim().replace(/\/+$/, "");

  const handleStartGitHubOAuth = () => {
    if (!normalizedHubUrl) {
      setErrorMessage(gt("Enter your Team Hub URL first."));
      return;
    }
    const redirectUri = `${window.location.origin}/cockpit`;
    window.location.assign(
      `${normalizedHubUrl}/api/v1/auth/github/start?redirect_uri=${encodeURIComponent(redirectUri)}`,
    );
  };

  const handleSubmit = async () => {
    if (!normalizedHubUrl) {
      setErrorMessage(gt("Enter your Team Hub URL."));
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);

    if (mode === "local") {
      if (!username.trim()) {
        setSubmitting(false);
        setErrorMessage(gt("Enter a username to sign in."));
        return;
      }
      const res = await connectLocal({
        environmentId,
        input: {
          hubUrl: normalizedHubUrl,
          username: username.trim(),
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        },
      });
      setSubmitting(false);
      if (res._tag === "Success") {
        onConnected(res.value);
      } else {
        setErrorMessage(formatCockpitCommandError(res, gt("Failed to connect to Team Hub.")));
      }
      return;
    }

    if (!accessToken.trim() || !refreshToken.trim()) {
      setSubmitting(false);
      setErrorMessage(gt("Enter both access token and refresh token."));
      return;
    }
    const res = await connectTokens({
      environmentId,
      input: {
        hubUrl: normalizedHubUrl,
        accessToken: accessToken.trim(),
        refreshToken: refreshToken.trim(),
      },
    });
    setSubmitting(false);
    if (res._tag === "Success") {
      onConnected(res.value);
    } else {
      setErrorMessage(formatCockpitCommandError(res, gt("Failed to connect with tokens.")));
    }
  };

  return (
    <div className="mx-auto my-8 w-full max-w-2xl">
      <CockpitSurface className="overflow-hidden" variant="grouped">
        <div className="border-b border-border/45 bg-muted/15 px-6 pt-7 pb-6">
          <div className="flex flex-col items-center text-center">
            <CockpitIllustration className="h-32 w-52" kind="connect_hub" />
            <h2 className="mt-3 text-lg font-semibold tracking-tight text-foreground">
              <T>Connect to Team Hub</T>
            </h2>
            <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-muted-foreground">
              <T>
                Connect this U3 Code environment to a self-hosted u3code-hub server for cross-repo
                work items, in-app PR review triage, release trains, and living project memory.
              </T>
            </p>
          </div>

          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
            <div className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/85 p-3 text-left shadow-2xs">
              <CockpitIconBadge className="mt-0.5" size="md" tone="violet">
                <CockpitStageArtworkIcon stage="prd" />
              </CockpitIconBadge>
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-medium text-foreground">
                  <T>AI PRDs & Prototypes</T>
                </div>
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  <T>Draft specs, live previews, and linked GitHub issues in one flow.</T>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/85 p-3 text-left shadow-2xs">
              <CockpitIconBadge className="mt-0.5" size="md" tone="info">
                <CockpitStageArtworkIcon stage="dev" />
              </CockpitIconBadge>
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-medium text-foreground">
                  <T>Swarm Collaboration Board</T>
                </div>
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  <T>Coordinate teammates and coding agents with @mentions and handoffs.</T>
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background/85 p-3 text-left shadow-2xs">
              <CockpitIconBadge className="mt-0.5" size="md" tone="success">
                <CockpitStageArtworkIcon stage="release" />
              </CockpitIconBadge>
              <div className="min-w-0 space-y-0.5">
                <div className="text-xs font-medium text-foreground">
                  <T>Bot-Gated Releases</T>
                </div>
                <p className="text-2xs leading-relaxed text-muted-foreground">
                  <T>Triage automated PR checks and sign off release trains safely.</T>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-center justify-between gap-2">
            <ToggleGroup
              size="segmented"
              value={[mode]}
              variant="segmented"
              onValueChange={(next) => {
                const value = next[0];
                if (value === "local" || value === "tokens") {
                  setMode(value);
                  setErrorMessage(null);
                }
              }}
            >
              <Toggle value="local">
                <TerminalIcon />
                <T>Local / Dev Sign-in</T>
              </Toggle>
              <Toggle value="tokens">
                <KeyRoundIcon />
                <T>OAuth / Token Sign-in</T>
              </Toggle>
            </ToggleGroup>
          </div>

          <form
            className="mt-4 space-y-3.5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <div>
              <CockpitFieldLabel htmlFor="hub-url">
                <T>Hub Server URL</T>
              </CockpitFieldLabel>
              <Input
                font="mono"
                id="hub-url"
                placeholder="http://127.0.0.1:4310"
                size="sm"
                value={hubUrl}
                onChange={(event) => setHubUrl(event.target.value)}
              />
            </div>

            {mode === "local" ? (
              <div className="grid gap-3.5 sm:grid-cols-2">
                <div>
                  <CockpitFieldLabel htmlFor="hub-username">
                    <T>Username</T>
                  </CockpitFieldLabel>
                  <Input
                    id="hub-username"
                    placeholder="alice"
                    size="sm"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </div>
                <div>
                  <CockpitFieldLabel htmlFor="hub-display-name">
                    <T>Display Name (optional)</T>
                  </CockpitFieldLabel>
                  <Input
                    id="hub-display-name"
                    placeholder={gt("Alice Chen")}
                    size="sm"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3.5">
                <CockpitSurface padding="sm" variant="subtle">
                  <div className="flex flex-wrap items-center justify-between gap-2.5 text-xs text-muted-foreground">
                    <span className="min-w-0 flex-1 leading-relaxed">
                      <T>
                        One-click GitHub OAuth redirects back to Team Cockpit and connects
                        automatically.
                      </T>
                    </span>
                    {normalizedHubUrl ? (
                      <Button size="xs" variant="outline" onClick={handleStartGitHubOAuth}>
                        <T>Sign in with GitHub</T>
                        <ExternalLinkIcon />
                      </Button>
                    ) : null}
                  </div>
                </CockpitSurface>

                <div>
                  <CockpitFieldLabel htmlFor="hub-access-token">
                    <T>Access Token</T>
                  </CockpitFieldLabel>
                  <Input
                    font="mono"
                    id="hub-access-token"
                    size="sm"
                    type="password"
                    value={accessToken}
                    onChange={(event) => setAccessToken(event.target.value)}
                  />
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="hub-refresh-token">
                    <T>Refresh Token</T>
                  </CockpitFieldLabel>
                  <Input
                    font="mono"
                    id="hub-refresh-token"
                    size="sm"
                    type="password"
                    value={refreshToken}
                    onChange={(event) => setRefreshToken(event.target.value)}
                  />
                </div>
              </div>
            )}

            {errorMessage ? (
              <CockpitInlineAlert tone="error">{errorMessage}</CockpitInlineAlert>
            ) : null}

            <div className="flex justify-end pt-1">
              <Button disabled={submitting} size="sm" type="submit" variant="default">
                {submitting ? <T>Connecting...</T> : <T>Connect</T>}
              </Button>
            </div>
          </form>
        </div>
      </CockpitSurface>
    </div>
  );
}
