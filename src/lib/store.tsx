"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { DEFAULT_OWNER, type OwnerConfig } from "./mock";

/**
 * Shared owner-config store, backed by the real PostgreSQL API.
 * Reads hydrate from the server; writes are optimistic in React state and
 * autosaved (debounced) with a PATCH — "Changes save as you make them."
 */
interface Store {
  config: OwnerConfig;
  /**
   * True once the server config has loaded. Anything that writes to the config
   * on mount (e.g. seeding the handle from the landing page's ?handle= param)
   * must wait for this, or hydration overwrites the write.
   */
  hydrated: boolean;
  /** True only after the server has acknowledged a completed account. */
  accountReady: boolean;
  loadError: string | null;
  saveState: "idle" | "saving" | "saved" | "error";
  saveError: string | null;
  update: (patch: Partial<OwnerConfig>) => void;
  setConfig: (fn: (prev: OwnerConfig) => OwnerConfig) => void;
  refresh: () => Promise<void>;
  retrySave: () => void;
}

const OwnerContext = createContext<Store | null>(null);

/**
 * A billing-lock response is authoritative for Stripe-owned fields. Preserve
 * edits made after the rejected request started, then let the save queue send
 * those unrelated changes again against the canonical currency.
 */
export function reconcileBillingCurrencyConflict(
  canonical: OwnerConfig,
  sent: OwnerConfig,
  current: OwnerConfig,
): OwnerConfig {
  const merged: OwnerConfig = { ...canonical };
  for (const key of Object.keys(current) as Array<keyof OwnerConfig>) {
    if (JSON.stringify(current[key]) !== JSON.stringify(sent[key])) {
      Object.assign(merged, { [key]: current[key] });
    }
  }
  merged.currency = canonical.currency;
  merged.billingCurrencyLocked = canonical.billingCurrencyLocked;
  return merged;
}

export function OwnerConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setState] = useState<OwnerConfig>(DEFAULT_OWNER);
  const [hydrated, setHydrated] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<Store["saveState"]>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  // JSON of the last server-acknowledged config — the autosave diffs against it.
  const synced = useRef<string>("");
  const configRef = useRef(config);
  const accountReadyRef = useRef(accountReady);
  const localRevision = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  configRef.current = config;
  accountReadyRef.current = accountReady;

  const refresh = useCallback(async () => {
    const revision = localRevision.current;
    const startedDirty =
      accountReadyRef.current && JSON.stringify(configRef.current) !== synced.current;
    setLoadError(null);
    try {
      const res = await fetch("/api/owner");
      if (!res.ok) throw new Error("Could not load your settings.");
      const cfg = (await res.json()) as OwnerConfig;
      // Only a completed account hydrates the store. A not-set-up instance
      // means we're in SIGNUP: the wizard starts from the blank defaults —
      // nothing is pulled out of the DB; the only seed is the ?handle param,
      // and the API is touched again just for validation (handle checks)
      // until "go live" ships the whole config in one PATCH.
      const canApply = !startedDirty && localRevision.current === revision;
      if (cfg.setupComplete && canApply) {
        synced.current = JSON.stringify(cfg);
        setState(cfg);
        accountReadyRef.current = true;
        setAccountReady(true);
      } else if (!cfg.setupComplete && canApply) {
        accountReadyRef.current = false;
        setAccountReady(false);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load your settings.");
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Put one save behind the previous one and read the newest config only when
   * its turn starts. This keeps autosave debounced without allowing an older,
   * slower response to overwrite a newer edit or a newer "saved" state.
   */
  const enqueueSave = useCallback(() => {
    saveQueue.current = saveQueue.current.then(async () => {
      const snapshot = configRef.current;
      if (!snapshot.setupComplete) return;
      const json = JSON.stringify(snapshot);
      if (json === synced.current) return;
      const revision = localRevision.current;
      setSaveState("saving");
      setSaveError(null);
      try {
        const res = await fetch("/api/owner", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: json,
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => null)) as {
            error?: string;
            code?: string;
            config?: OwnerConfig;
          } | null;
          if (
            res.status === 409 &&
            detail?.code === "BILLING_CURRENCY_LOCKED" &&
            detail.config
          ) {
            const canonical = detail.config;
            synced.current = JSON.stringify(canonical);
            const stillLatest = localRevision.current === revision;
            setState((current) =>
              stillLatest
                ? canonical
                : reconcileBillingCurrencyConflict(canonical, snapshot, current),
            );
            accountReadyRef.current = Boolean(canonical.setupComplete);
            setAccountReady(accountReadyRef.current);
            setSaveState(stillLatest ? "saved" : "saving");
            return;
          }
          throw new Error(detail?.error ?? "Changes could not be saved.");
        }
        synced.current = json;
        const canon = (await res.json()) as OwnerConfig;
        const stillLatest = localRevision.current === revision;
        setState((cur) => {
          if (!stillLatest || JSON.stringify(cur) !== json) return cur;
          const merged = { ...canon, startHour: cur.startHour, endHour: cur.endHour };
          synced.current = JSON.stringify(merged);
          return merged;
        });
        accountReadyRef.current = Boolean(canon.setupComplete);
        setAccountReady(accountReadyRef.current);
        setSaveState(stillLatest ? "saved" : "saving");
      } catch (error) {
        setSaveState("error");
        setSaveError(error instanceof Error ? error.message : "Changes could not be saved.");
      }
    });
  }, []);

  // Autosave, debounced (README: "Autosave settings (debounced), optimistic UI").
  // During signup nothing is saved: the setup flow stays local until "You're
  // done — go live" flips setupComplete, and THAT change ships the whole
  // config (handle, name, email, service, hours) in one PATCH — the signup.
  useEffect(() => {
    if (!hydrated || !config.setupComplete) return;
    const json = JSON.stringify(config);
    if (json === synced.current) return;
    const t = setTimeout(enqueueSave, 300);
    return () => clearTimeout(t);
  }, [config, enqueueSave, hydrated, retryNonce]);

  const setConfig = useCallback(
    (fn: (prev: OwnerConfig) => OwnerConfig) => {
      localRevision.current += 1;
      setState(fn);
    },
    [],
  );
  const update = useCallback(
    (patch: Partial<OwnerConfig>) => {
      localRevision.current += 1;
      setState((p) => ({ ...p, ...patch }));
    },
    [],
  );
  const retrySave = useCallback(() => setRetryNonce((value) => value + 1), []);

  return (
    <OwnerContext.Provider
      value={{
        config,
        hydrated,
        accountReady,
        loadError,
        saveState,
        saveError,
        update,
        setConfig,
        refresh,
        retrySave,
      }}
    >
      {children}
    </OwnerContext.Provider>
  );
}

export function useOwnerConfig(): Store {
  const ctx = useContext(OwnerContext);
  if (!ctx)
    throw new Error("useOwnerConfig must be used within an OwnerConfigProvider");
  return ctx;
}

/**
 * Read the published owner config outside the provider (the public booking page
 * lives on booktimewith.link and doesn't share the owner app's React tree).
 * `ready` flips once the server answered — render nothing meaningful before it.
 */
export function usePublishedConfig(scope?: {
  handle?: string;
  manageToken?: string;
}): {
  config: OwnerConfig;
  ready: boolean;
  error: string | null;
  retry: () => void;
} {
  const [state, setState] = useState({
    config: DEFAULT_OWNER,
    ready: false,
    error: null as string | null,
  });
  const [retryNonce, setRetryNonce] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, ready: false, error: null }));
    const params = new URLSearchParams({ public: "1" });
    if (scope?.handle) {
      params.set("handle", scope.handle);
    } else if (scope?.manageToken) {
      params.set("manageToken", scope.manageToken);
    } else {
      // Existing booking/manage components do not receive the route handle as a
      // prop, so derive the same explicit API scope from their public pathname.
      const parts = window.location.pathname.split("/").filter(Boolean);
      if (parts[0] === "manage" && parts[1]) params.set("manageToken", parts[1]);
      else if (parts[0]) params.set("handle", parts[0]);
    }
    // the public subset — no owner email, prefs, billing, cells, or address
    fetch(`/api/owner?${params.toString()}`, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("Public owner not found");
        return r.json();
      })
      .then((cfg: OwnerConfig) => setState({ config: cfg, ready: true, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          ready: true,
          error: error instanceof Error ? error.message : "This booking page could not be loaded.",
        }));
      });
    return () => controller.abort();
  }, [retryNonce, scope?.handle, scope?.manageToken]);
  return {
    ...state,
    retry: () => setRetryNonce((value) => value + 1),
  };
}
