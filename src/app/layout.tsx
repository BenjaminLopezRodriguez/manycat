import "@/styles/globals.css";

import { type Metadata } from "next";
import { DM_Sans, Figtree } from "next/font/google";

import { AuthSessionProvider } from "@/components/auth-session-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TRPCReactProvider } from "@/trpc/react";
import { cn } from "@/lib/utils";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });

const figtreeHeading = Figtree({
  subsets: ["latin"],
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "manycat",
  description: "Chat with all your cats. Highlights, just for you.",
  icons: [
    {
      rel: "icon",
      url: "/manycat-logo.png",
      media: "(prefers-color-scheme: light)",
    },
    {
      rel: "icon",
      url: "/manycat-logo-dark.png",
      media: "(prefers-color-scheme: dark)",
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans", dmSans.variable, figtreeHeading.variable)}
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          themes={["light", "dark", "dark-contrast"]}
          disableTransitionOnChange
        >
          <AuthSessionProvider>
            <TRPCReactProvider>{children}</TRPCReactProvider>
          </AuthSessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
