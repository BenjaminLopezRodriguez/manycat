import Link from "next/link";

import { ManycatLogo } from "@/components/manycat-logo";
import { Button } from "@/components/ui/button";

export default async function SharedChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="bg-background flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <ManycatLogo alt="Manycat" width={48} height={48} className="size-12" />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Shared chat</h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Someone shared a Manycat chat with you
            <span className="mt-1 block font-mono text-xs opacity-70">
              {id}
            </span>
          </p>
        </div>
        <Button render={<Link href="/" />}>Open Manycat</Button>
      </div>
    </div>
  );
}
