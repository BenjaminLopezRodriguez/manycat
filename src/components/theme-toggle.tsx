"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ComputerIcon,
  ContrastIcon,
  Moon02Icon,
  Sun02Icon,
} from "@hugeicons/core-free-icons";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun02Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "dark-contrast", label: "Dark contrast", icon: ContrastIcon },
  { value: "system", label: "System", icon: ComputerIcon },
] as const;

function useMountedTheme() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  return {
    theme: mounted ? (theme ?? "system") : "system",
    setTheme,
    mounted,
  };
}

function ThemeGlyph({
  theme,
  size = 20,
  className,
}: {
  theme: string;
  size?: number;
  className?: string;
}) {
  const icon =
    theme === "dark-contrast"
      ? ContrastIcon
      : theme === "dark"
        ? Moon02Icon
        : theme === "system"
          ? ComputerIcon
          : Sun02Icon;
  return <HugeiconsIcon icon={icon} size={size} className={className} />;
}

function ThemeRadioGroup({
  theme,
  setTheme,
}: {
  theme: string;
  setTheme: (value: string) => void;
}) {
  return (
    <DropdownMenuRadioGroup
      value={theme}
      onValueChange={(value) => {
        if (typeof value === "string") setTheme(value);
      }}
    >
      {THEME_OPTIONS.map((option) => (
        <DropdownMenuRadioItem key={option.value} value={option.value}>
          <HugeiconsIcon icon={option.icon} size={16} />
          {option.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** Sidebar rail control — matches RailButton chrome. */
export function ThemeRailButton() {
  const { theme, setTheme } = useMountedTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Theme"
        className={cn(
          "text-sidebar-foreground/50 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground/80 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors outline-none",
          "focus-visible:ring-sidebar-foreground/30 focus-visible:ring-2",
        )}
      >
        <span className="relative flex size-5 shrink-0 items-center justify-center">
          <ThemeGlyph theme={theme} />
        </span>
        <span className="min-w-0 flex-1 truncate text-left">Theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="min-w-40">
        <ThemeRadioGroup theme={theme} setTheme={setTheme} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Theme picker for mobile drawers. */
export function ThemeDrawerSection({
  onActionComplete,
}: {
  onActionComplete?: () => void;
}) {
  const { theme, setTheme } = useMountedTheme();

  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground px-3 py-1.5 text-xs font-medium">
        Theme
      </div>
      {THEME_OPTIONS.map((option) => {
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            className={cn(
              "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors",
              active
                ? "bg-muted text-foreground"
                : "hover:bg-muted/60 text-foreground",
            )}
            onClick={() => {
              setTheme(option.value);
              onActionComplete?.();
            }}
          >
            <HugeiconsIcon icon={option.icon} size={16} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Icon-only control for pages without a sidebar (e.g. sign-in). */
export function ThemeToggle({
  className,
  align = "end",
}: {
  className?: string;
  align?: "start" | "center" | "end";
}) {
  const { theme, setTheme } = useMountedTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Theme"
        className={cn(
          "text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-9 items-center justify-center rounded-full transition-colors outline-none",
          "focus-visible:ring-ring/30 focus-visible:ring-3",
          className,
        )}
      >
        <ThemeGlyph theme={theme} size={18} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-40">
        <ThemeRadioGroup theme={theme} setTheme={setTheme} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
