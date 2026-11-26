/**
 * Business settings (restaurant profile + receipt layout), shared app-wide.
 *
 * `useBusinessSettings()` is the React path (tRPC query, cached 5 min).
 * A module-level cache is kept warm by the hook so non-React callers — like
 * the printer manager building ESC/POS bytes — can read the latest values
 * synchronously via `getCachedBusinessSettings()`.
 */
import { useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { DEFAULT_SETTINGS, type BusinessSettings } from "@contracts/settings";

let cached: BusinessSettings = DEFAULT_SETTINGS;

export function getCachedBusinessSettings(): BusinessSettings {
  return cached;
}

/** Prime the cache from outside React (e.g. app bootstrap after login). */
export function primeBusinessSettings(value: BusinessSettings): void {
  cached = value;
}

export function useBusinessSettings(): BusinessSettings {
  const q = trpc.settings.get.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const value = q.data ?? DEFAULT_SETTINGS;
  useEffect(() => {
    if (q.data) cached = q.data;
  }, [q.data]);
  return value;
}
