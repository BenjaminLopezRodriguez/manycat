import { NextResponse } from "next/server";

import { auth, authConfigured } from "@/auth";

export default auth((req) => {
  // Until at least one OAuth provider is set, don't lock the app behind auth.
  if (!authConfigured) return;

  const { pathname } = req.nextUrl;
  const isAuthRoute =
    pathname.startsWith("/signin") || pathname.startsWith("/api/auth");

  if (!req.auth && !isAuthRoute) {
    const url = new URL("/signin", req.nextUrl.origin);
    url.searchParams.set(
      "callbackUrl",
      `${pathname}${req.nextUrl.search}`,
    );
    return NextResponse.redirect(url);
  }

  if (req.auth && pathname.startsWith("/signin")) {
    return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
