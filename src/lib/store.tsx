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

const STORAGE_KEY = "btw:owner-config";

/**
 * Shared owner-config store. Backed by localStorage as a stand-in for the phase-2
 * server: the owner app reads/writes it, and the public booking page reads it so
 * service/handle/hours edits flow through — the "live" feel of the design prototype.
 */
interface Store {
  config: OwnerConfig;
  update: (patch: Partial<OwnerConfig>) => void;
  setConfig: (fn: (prev: OwnerConfig) => OwnerConfig) => void;
  reset: () => void;
}

const OwnerContext = createContext<Store | null>(null);

function load(): OwnerConfig {
  if (typeof window === "undefined") return DEFAULT_OWNER;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_OWNER;
    return { ...DEFAULT_OWNER, ...(JSON.parse(raw) as Partial<OwnerConfig>) };
  } catch {
    return DEFAULT_OWNER;
  }
}

export function OwnerConfigProvider({ children }: { children: React.ReactNode }) {
  // Start from defaults on both server and first client render to avoid a
  // hydration mismatch, then hydrate from storage in an effect.
  const [config, setState] = useState<OwnerConfig>(DEFAULT_OWNER);
  const hydrated = useRef(false);

  useEffect(() => {
    setState(load());
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* storage disabled — non-fatal in the demo */
    }
  }, [config]);

  const setConfig = useCallback(
    (fn: (prev: OwnerConfig) => OwnerConfig) => setState(fn),
    [],
  );
  const update = useCallback(
    (patch: Partial<OwnerConfig>) => setState((p) => ({ ...p, ...patch })),
    [],
  );
  const reset = useCallback(() => setState(DEFAULT_OWNER), []);

  return (
    <OwnerContext.Provider value={{ config, update, setConfig, reset }}>
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
 * Reactive to edits made in another tab via the storage event.
 */
export function usePublishedConfig(): OwnerConfig {
  const [config, setConfig] = useState<OwnerConfig>(DEFAULT_OWNER);
  useEffect(() => {
    setConfig(load());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setConfig(load());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return config;
}
