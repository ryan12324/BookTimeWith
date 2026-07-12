/** Small structured logger shared by Node and Edge runtimes. */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEYS = [
  "authorization", "cookie", "secret", "password", "token", "signature",
  "html", "body", "email", "name", "notes",
];
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function threshold(): number {
  const configured = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  return configured && configured in LEVELS
    ? LEVELS[configured]
    : process.env.NODE_ENV === "production" ? LEVELS.info
      : process.env.NODE_ENV === "test" ? LEVELS.warn
        : LEVELS.debug;
}

function sensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_KEYS.some((candidate) => normalized.includes(candidate));
}

function clean(value: unknown, key = "", seen = new WeakSet<object>()): unknown {
  if (sensitiveKey(key)) return "[REDACTED]";
  if (value instanceof Error) {
    return {
      type: value.name,
      message: value.message.replace(BEARER, "Bearer [REDACTED]").replace(EMAIL, "[REDACTED_EMAIL]"),
      stack: value.stack?.replace(BEARER, "Bearer [REDACTED]").replace(EMAIL, "[REDACTED_EMAIL]"),
      ...(value.cause === undefined ? {} : { cause: clean(value.cause, "cause", seen) }),
    };
  }
  if (typeof value === "string") {
    return value.replace(BEARER, "Bearer [REDACTED]").replace(EMAIL, "[REDACTED_EMAIL]");
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => clean(item, key, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
      childKey,
      clean(child, childKey, seen),
    ]),
  );
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVELS[level] < threshold()) return;
  const entry = clean({
    timestamp: new Date().toISOString(),
    level,
    service: "booktimewith",
    environment: process.env.NODE_ENV ?? "development",
    event,
    ...fields,
  });
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.info(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};

export function requestId(headers: Headers): string {
  return headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
}

export async function loggedOperation<T>(
  event: string,
  fields: LogFields,
  operation: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  log.debug(`${event}.started`, fields);
  try {
    const result = await operation();
    log.info(`${event}.completed`, { ...fields, durationMs: Math.round(performance.now() - started) });
    return result;
  } catch (error) {
    log.error(`${event}.failed`, { ...fields, durationMs: Math.round(performance.now() - started), error });
    throw error;
  }
}
