import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  isSupabaseConfigured,
  supabaseAnonKey,
  supabaseUrl,
} from "@/lib/supabase/config";

/**
 * Route protection and session refresh.
 *
 * Named `proxy` rather than `middleware`: Next.js 16 deprecated the
 * `middleware.js` convention and renamed it to `proxy.js`. Behaviour is
 * unchanged, only the file and export names moved.
 */

/**
 * Paths reachable without a session. Everything else redirects to /login.
 * `/` stays public so the landing page can explain the product before asking
 * anyone to hand over GitHub access.
 */
const PUBLIC_PATHS = ["/", "/login"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

function redirectToLogin(request: NextRequest, reason?: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";

  // Send the visitor back where they were headed once they are signed in.
  if (request.nextUrl.pathname !== "/") {
    url.searchParams.set("next", request.nextUrl.pathname);
  }
  if (reason) {
    url.searchParams.set("error", reason);
  }

  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const isPublic = isPublicPath(request.nextUrl.pathname);

  // Without Supabase credentials there is no way to establish a session, so
  // fail closed: public pages still render, everything else bounces to /login,
  // which explains what is missing.
  if (!isSupabaseConfigured()) {
    return isPublic ? NextResponse.next() : redirectToLogin(request, "unconfigured");
  }

  // Reassigned by setAll below whenever Supabase rotates the session cookies.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser revalidates against Supabase, unlike getSession which trusts
  // whatever the cookie claims. On a path that decides access, that matters.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    return redirectToLogin(request);
  }

  // Already signed in and staring at the sign-in page — send them onward.
  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = request.nextUrl.searchParams.get("next") ?? "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Must be returned as-is: it carries the refreshed session cookies.
  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static files. Auth checks on an
     * image request cost a round trip to Supabase and decide nothing.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
