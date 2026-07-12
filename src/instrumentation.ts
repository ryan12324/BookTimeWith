import { log } from "@/lib/logger";

export function register() {
  log.info("server.started", {
    nodeVersion: process.version,
    deployment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
  });
}

export function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string> },
  context: { routerKind: string; routePath: string; routeType: string; renderSource?: string },
) {
  log.error("request.unhandled_error", {
    requestId: request.headers["x-request-id"],
    method: request.method,
    path: request.path,
    route: context.routePath,
    routerKind: context.routerKind,
    routeType: context.routeType,
    renderSource: context.renderSource,
    error,
  });
}
