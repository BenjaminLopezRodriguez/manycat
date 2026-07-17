import Image from "next/image";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

import { auth, githubAuthConfigured, signIn } from "@/auth";
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
            Sign in with GitHub to import repos and run workflows.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3">
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
              <Button type="submit" size="lg" className="w-full gap-2">
                <GitHubMark className="size-4" />
                Continue with GitHub
              </Button>
            </form>
          ) : (
            <div className="bg-muted/40 w-full rounded-2xl border p-4 text-sm">
              <p className="font-medium">GitHub OAuth not configured</p>
              <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
                Create an OAuth App with callback{" "}
                <code className="font-mono text-[11px]">
                  http://localhost:3000/api/auth/callback/github
                </code>{" "}
                and set{" "}
                <code className="font-mono text-[11px]">AUTH_GITHUB_ID</code> /{" "}
                <code className="font-mono text-[11px]">AUTH_GITHUB_SECRET</code>{" "}
                in <code className="font-mono text-[11px]">.env</code>.
              </p>
            </div>
          )}

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
                Continue locally (skip GitHub)
              </Button>
            </form>
          ) : null}

          {isDev && githubAuthConfigured ? (
            <p className="text-muted-foreground text-center text-xs leading-relaxed">
              GitHub redirect errors usually mean the OAuth App callback is set
              to production. Use a separate local OAuth App with callback{" "}
              <code className="font-mono text-[10px]">
                http://localhost:3000/api/auth/callback/github
              </code>
              , or use Continue locally above.
            </p>
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
