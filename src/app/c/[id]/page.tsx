"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

import { ManycatLogo } from "@/components/manycat-logo";
import { Button } from "@/components/ui/button";
import { api } from "@/trpc/react";

function SharedChatInner({ id }: { id: string }) {
  const search = useSearchParams();
  const joinToken = search.get("join");
  const router = useRouter();
  const { data: session, status } = useSession();
  const joinMutation = api.work.joinSession.useMutation();
  const [error, setError] = React.useState<string | null>(null);
  const [joining, setJoining] = React.useState(false);
  const autoStarted = React.useRef(false);

  async function handleJoin() {
    if (!joinToken) return;
    setJoining(true);
    setError(null);
    try {
      const result = await joinMutation.mutateAsync({ token: joinToken });
      router.push(
        `/?mode=workspace&view=work&session=${encodeURIComponent(result.workflowId)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Join failed");
      setJoining(false);
    }
  }

  React.useEffect(() => {
    if (
      status !== "authenticated" ||
      !joinToken ||
      joining ||
      joinMutation.isSuccess ||
      autoStarted.current
    ) {
      return;
    }
    autoStarted.current = true;
    void handleJoin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, joinToken]);

  const signedIn = Boolean(session?.user);

  return (
    <div className="bg-background flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <ManycatLogo alt="Manycat" width={48} height={48} className="size-12" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {joinToken ? "Join Work chat" : "Shared chat"}
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {joinToken
              ? "You’ve been invited to a Manycat Work chat."
              : "Someone shared a Manycat chat with you."}
            <span className="mt-1 block font-mono text-xs opacity-70">{id}</span>
          </p>
          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}
        </div>
        {joinToken ? (
          signedIn ? (
            <Button onClick={() => void handleJoin()} disabled={joining}>
              {joining ? "Joining…" : "Join chat"}
            </Button>
          ) : (
            <Button
              render={
                <Link
                  href={`/signin?callbackUrl=${encodeURIComponent(`/c/${id}?join=${joinToken}`)}`}
                />
              }
            >
              Sign in to join
            </Button>
          )
        ) : (
          <Button render={<Link href="/" />}>Open Manycat</Button>
        )}
      </div>
    </div>
  );
}

export default function SharedChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  return (
    <React.Suspense
      fallback={
        <div className="bg-background flex min-h-dvh items-center justify-center text-sm">
          Loading…
        </div>
      }
    >
      <SharedChatInner id={id} />
    </React.Suspense>
  );
}
