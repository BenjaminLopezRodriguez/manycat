import Image from "next/image";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import {
  auth,
  githubAuthConfigured,
  googleAuthConfigured,
  signIn,
} from "@/auth";
import { Button } from "@/components/ui/button";

const isDev = process.env.NODE_ENV === "development";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const callbackUrl = params.callbackUrl ?? "/";

  if (session?.user) {
    redirect(callbackUrl);
  }

  return (
    <div className="bg-background flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/manycat-logo.png"
            alt="manycat"
            width={56}
            height={56}
            className="size-14"
            priority
          />
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            manycat
          </h1>
          <p className="text-muted-foreground text-sm">
            Sign in to build and deploy. Connect GitHub anytime to import your
            repos.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3">
          {googleAuthConfigured ? (
            <form
              action={async () => {
                "use server";
                try {
                  await signIn("google", { redirectTo: callbackUrl });
                } catch (error) {
                  if (error instanceof AuthError) {
                    redirect(`/signin?error=${error.type}`);
                  }
                  throw error;
                }
              }}
            >
              <Button type="submit" size="lg" className="w-full gap-2">
                <GoogleMark className="size-4" />
                Continue with Google
              </Button>
            </form>
          ) : null}

          {githubAuthConfigured ? (
            <form
              action={async () => {
                "use server";
                try {
                  await signIn("github", { redirectTo: callbackUrl });
                } catch (error) {
                  if (error instanceof AuthError) {
                    redirect(`/signin?error=${error.type}`);
                  }
                  throw error;
                }
              }}
            >
              <Button
                type="submit"
                size="lg"
                variant={googleAuthConfigured ? "outline" : "default"}
                className="w-full gap-2"
              >
                <GitHubMark className="size-4" />
                Continue with GitHub
              </Button>
            </form>
          ) : null}

          {!googleAuthConfigured && !githubAuthConfigured ? (
            <div className="bg-muted/40 w-full rounded-2xl border p-4 text-sm">
              <p className="font-medium">OAuth not configured</p>
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                Set{" "}
                <code className="font-mono text-[11px]">AUTH_GOOGLE_ID</code> /{" "}
                <code className="font-mono text-[11px]">AUTH_GOOGLE_SECRET</code>{" "}
                and/or GitHub OAuth vars in{" "}
                <code className="font-mono text-[11px]">.env</code>.
              </p>
            </div>
          ) : null}

          {isDev ? (
            <form
              action={async () => {
                "use server";
                try {
                  await signIn("dev", { redirectTo: callbackUrl });
                } catch (error) {
                  if (error instanceof AuthError) {
                    redirect(`/signin?error=${error.type}`);
                  }
                  throw error;
                }
              }}
            >
              <Button
                type="submit"
                size="lg"
                variant="outline"
                className="w-full"
              >
                Continue locally (skip OAuth)
              </Button>
            </form>
          ) : null}
        </div>

        {params.error ? (
          <p className="text-destructive text-center text-sm">
            Sign-in failed ({params.error}). Try again.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
