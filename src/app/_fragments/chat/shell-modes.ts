import {
  ArrowUpRight01Icon,
  BotIcon,
  BubbleChatIcon,
  CloudUploadIcon,
  Link01Icon,
  News01Icon,
  Search01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { env } from "@/env";

export type ModeId = "dev" | "workspace" | "research";

export type ShellView =
  | "projects"
  | "workflows"
  | "deployments"
  | "agents"
  | "integrations"
  | "connections"
  | "automations"
  | "activity"
  | "chats"
  | "research"
  | "sources";

export type NavItem = {
  view: ShellView;
  label: string;
  icon: typeof News01Icon;
};

export type ModeDef = {
  id: ModeId;
  label: string;
  home: ShellView;
  nav: NavItem[];
};

export const DEFAULT_SHELL = {
  mode: "dev" as const satisfies ModeId,
  view: "projects" as const satisfies ShellView,
};

const ALL_MODE_IDS: ModeId[] = ["dev", "workspace", "research"];

export const MODE_CATALOG: ModeDef[] = [
  {
    id: "dev",
    label: "Dev agents",
    home: "projects",
    nav: [
      { view: "projects", label: "Projects", icon: News01Icon },
      { view: "workflows", label: "Workflows", icon: BubbleChatIcon },
      { view: "deployments", label: "Deployments", icon: CloudUploadIcon },
      { view: "agents", label: "Agents", icon: BotIcon },
      { view: "integrations", label: "Integrations", icon: Link01Icon },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    home: "connections",
    nav: [
      { view: "connections", label: "Connections", icon: Link01Icon },
      { view: "automations", label: "Automations", icon: Settings01Icon },
      { view: "activity", label: "Activity", icon: ArrowUpRight01Icon },
    ],
  },
  {
    id: "research",
    label: "Chat + Research",
    home: "chats",
    nav: [
      { view: "chats", label: "Chats", icon: BubbleChatIcon },
      { view: "research", label: "Research", icon: Search01Icon },
      { view: "sources", label: "Sources", icon: News01Icon },
    ],
  },
];

export function parseEnabledModes(raw: string | undefined): ModeId[] {
  const tokens = (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const enabled = new Set<ModeId>();
  for (const t of tokens) {
    if ((ALL_MODE_IDS as string[]).includes(t)) enabled.add(t as ModeId);
  }
  enabled.add("dev");
  return ALL_MODE_IDS.filter((id) => enabled.has(id));
}

export function getModes(enabled?: ModeId[]): ModeDef[] {
  const allow = new Set(enabled ?? parseEnabledModes(env.NEXT_PUBLIC_ENABLED_MODES));
  return MODE_CATALOG.filter((m) => allow.has(m.id));
}

export function isModeEnabled(id: ModeId, enabled?: ModeId[]): boolean {
  return (enabled ?? parseEnabledModes(env.NEXT_PUBLIC_ENABLED_MODES)).includes(
    id,
  );
}

export function modeHome(id: ModeId): ShellView {
  return MODE_CATALOG.find((m) => m.id === id)?.home ?? DEFAULT_SHELL.view;
}

export function isViewInMode(mode: ModeId, view: ShellView): boolean {
  const def = MODE_CATALOG.find((m) => m.id === mode);
  return Boolean(def?.nav.some((n) => n.view === view));
}

/** Convenience: enabled modes at module evaluation (client bundle). */
export const MODES = getModes();
