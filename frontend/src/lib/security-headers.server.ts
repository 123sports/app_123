function contentSecurityPolicy() {
  const connectSources = new Set(["'self'"]);
  const rawSupabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

  if (rawSupabaseUrl) {
    try {
      const supabaseUrl = new URL(rawSupabaseUrl);
      connectSources.add(supabaseUrl.origin);
      const realtimeUrl = new URL(supabaseUrl.origin);
      realtimeUrl.protocol = supabaseUrl.protocol === "https:" ? "wss:" : "ws:";
      connectSources.add(realtimeUrl.origin);
    } catch {
      // Environment validation reports the malformed URL at startup/use time.
    }
  }

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    `connect-src ${[...connectSources].join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function withSecurityHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", contentSecurityPolicy());
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");

  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const isHttps = forwardedProtocol
    ? forwardedProtocol === "https"
    : new URL(request.url).protocol === "https:";

  if (isHttps) {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
