import type { EnvironmentId, TeamHubStatusResult } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { ExternalLinkIcon, KeyRoundIcon, ServerIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
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
    <div className="mx-auto mt-8 w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xs">
      <div className="flex items-center gap-2 text-foreground">
        <ServerIcon className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">
          <T>Connect to Team Hub</T>
        </h2>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">
        <T>
          Connect this environment to a self-hosted u3code-hub server to view cross-repo work items,
          automated review triage, living project memory, and AI digests.
        </T>
      </p>

      <div className="mt-4 flex items-center gap-2">
        <Button
          size="sm"
          variant={mode === "local" ? "default" : "outline"}
          onClick={() => {
            setMode("local");
            setErrorMessage(null);
          }}
        >
          <T>Local / Dev Sign-in</T>
        </Button>
        <Button
          size="sm"
          variant={mode === "tokens" ? "default" : "outline"}
          onClick={() => {
            setMode("tokens");
            setErrorMessage(null);
          }}
        >
          <KeyRoundIcon />
          <T>OAuth / Token Sign-in</T>
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="hub-url">
            <T>Hub Server URL</T>
          </label>
          <Input
            id="hub-url"
            placeholder="http://127.0.0.1:4310"
            value={hubUrl}
            onChange={(event) => setHubUrl(event.target.value)}
          />
        </div>

        {mode === "local" ? (
          <>
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor="hub-username"
              >
                <T>Username</T>
              </label>
              <Input
                id="hub-username"
                placeholder="alice"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor="hub-display-name"
              >
                <T>Display Name (optional)</T>
              </label>
              <Input
                id="hub-display-name"
                placeholder={gt("Alice Chen")}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
              <span>
                <T>
                  One-click GitHub OAuth redirects back to Team Cockpit and connects automatically.
                </T>
              </span>
              {normalizedHubUrl ? (
                <Button size="xs" variant="default" onClick={handleStartGitHubOAuth}>
                  <T>Sign in with GitHub</T>
                  <ExternalLinkIcon className="size-3" />
                </Button>
              ) : null}
            </div>
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor="hub-access-token"
              >
                <T>Access Token</T>
              </label>
              <Input
                id="hub-access-token"
                type="password"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
              />
            </div>
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor="hub-refresh-token"
              >
                <T>Refresh Token</T>
              </label>
              <Input
                id="hub-refresh-token"
                type="password"
                value={refreshToken}
                onChange={(event) => setRefreshToken(event.target.value)}
              />
            </div>
          </>
        )}

        {errorMessage ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {errorMessage}
          </p>
        ) : null}

        <div className="flex justify-end pt-1">
          <Button disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? <T>Connecting...</T> : <T>Connect</T>}
          </Button>
        </div>
      </div>
    </div>
  );
}
