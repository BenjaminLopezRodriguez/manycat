"use client";

import * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { signIn, signOut } from "next-auth/react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { ModeDef, ModeId } from "./shell-modes";

type AccountProps = {
  signedIn: boolean;
  label: string;
  image?: string | null;
  initials: string;
  provider?: "github" | "google" | "dev" | null;
  onOpenIntegrations?: () => void;
};

type ModeProps = {
  modes: ModeDef[];
  mode: ModeId;
  onModeChange: (mode: ModeId) => void;
};

function providerLabel(
  provider: AccountProps["provider"],
): string {
  if (provider === "google") return "Google";
  if (provider === "github") return "GitHub";
  if (provider === "dev") return "local";
  return "account";
}

function AccountMenuItems({
  signedIn,
  provider,
  onOpenIntegrations,
}: Pick<AccountProps, "signedIn" | "provider" | "onOpenIntegrations">) {
  if (signedIn) {
    return (
      <>
        <div className="text-muted-foreground px-3 py-2 text-xs">
          Signed in with {providerLabel(provider)}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            onOpenIntegrations?.();
          }}
        >
          Integrations
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            void signOut({ callbackUrl: "/signin" });
          }}
        >
          Sign out
        </DropdownMenuItem>
      </>
    );
  }

  return (
    <>
      <DropdownMenuItem
        onClick={() => {
          void signIn("google", { callbackUrl: "/" });
        }}
      >
        Continue with Google
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => {
          void signIn("github", { callbackUrl: "/" });
        }}
      >
        Continue with GitHub
      </DropdownMenuItem>
    </>
  );
}

export function ShellModeMenu({
  modes,
  mode,
  onModeChange,
  signedIn,
  image,
  initials,
  provider,
  onOpenIntegrations,
}: ModeProps & AccountProps) {
  const [open, setOpen] = React.useState(false);
  const currentLabel =
    modes.find((m) => m.id === mode)?.label ?? "Build";
  const showModeSection = modes.length >= 2;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          "hover:bg-sidebar-primary-foreground/10 flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-2 py-1.5 text-left transition-colors",
          "outline-none focus-visible:ring-2 focus-visible:ring-sidebar-primary-foreground/30",
        )}
      >
        <Avatar className="size-6">
          {image ? <AvatarImage src={image} alt="" /> : null}
          <AvatarFallback className="bg-sidebar-primary-foreground/15 text-[10px] font-semibold">
            {signedIn ? initials : "MC"}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {currentLabel}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          className="text-sidebar-primary-foreground/60 shrink-0"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {showModeSection ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Mode</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={mode}
                onValueChange={(value) => {
                  if (typeof value === "string") {
                    onModeChange(value as ModeId);
                    setOpen(false);
                  }
                }}
              >
                {modes.map((m) => (
                  <DropdownMenuRadioItem key={m.id} value={m.id}>
                    {m.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <AccountMenuItems
          signedIn={signedIn}
          provider={provider}
          onOpenIntegrations={onOpenIntegrations}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shared Mode + Account body for the mobile account drawer (Task 5). */
export function ShellModeDrawerBody({
  modes,
  mode,
  onModeChange,
  signedIn,
  label,
  image,
  initials,
  provider,
  onOpenIntegrations,
  onActionComplete,
}: ModeProps &
  AccountProps & {
    onActionComplete?: () => void;
  }) {
  const showModeSection = modes.length >= 2;

  return (
    <div className="flex flex-col gap-1">
      {showModeSection ? (
        <div className="flex flex-col gap-1 pb-2">
          <div className="text-muted-foreground px-3 py-1.5 text-xs font-medium">
            Mode
          </div>
          {modes.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={active}
                className={cn(
                  "rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "hover:bg-muted/60 text-foreground",
                )}
                onClick={() => {
                  onModeChange(m.id);
                  onActionComplete?.();
                }}
              >
                {m.label}
              </button>
            );
          })}
          <div className="bg-border mx-2 my-2 h-px" />
        </div>
      ) : null}

      {signedIn ? (
        <>
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <Avatar className="size-8">
              {image ? <AvatarImage src={image} alt="" /> : null}
              <AvatarFallback className="text-[10px] font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{label}</div>
              <div className="text-muted-foreground truncate text-xs">
                Signed in with {providerLabel(provider)}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="hover:bg-muted/60 rounded-xl px-3 py-2.5 text-left text-sm font-medium"
            onClick={() => {
              onActionComplete?.();
              onOpenIntegrations?.();
            }}
          >
            Integrations
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:bg-muted/60 hover:text-foreground rounded-xl px-3 py-2.5 text-left text-sm font-medium"
            onClick={() => {
              onActionComplete?.();
              void signOut({ callbackUrl: "/signin" });
            }}
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="bg-primary text-primary-foreground rounded-xl px-3 py-2.5 text-left text-sm font-medium"
            onClick={() => {
              onActionComplete?.();
              void signIn("google", { callbackUrl: "/" });
            }}
          >
            Continue with Google
          </button>
          <button
            type="button"
            className="hover:bg-muted/60 rounded-xl px-3 py-2.5 text-left text-sm font-medium"
            onClick={() => {
              onActionComplete?.();
              void signIn("github", { callbackUrl: "/" });
            }}
          >
            Continue with GitHub
          </button>
        </>
      )}
    </div>
  );
}
