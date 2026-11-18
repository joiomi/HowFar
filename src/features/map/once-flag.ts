/**
 * One-time flags kept in localStorage: a hint shown once per device stays
 * dismissed across visits. Storage can be missing or refuse access (a private
 * window, blocked site data, a full quota), so every access sits in try/catch:
 * a flag that cannot be read counts as unset, and a write that fails is dropped.
 * Neither call ever throws. Each key carries a version suffix, so changing what a
 * flag means starts it over with a new key instead of reusing a stale "seen".
 */

/** Set once the hold-on-the-map hint has been shown on this device. */
export const HOLD_HINT_KEY = "hf:hold-hint:v1";

const pageStorage = (): Storage => window.localStorage;

export function readOnceFlag(key: string, getStorage: () => Storage = pageStorage): boolean {
  try {
    return getStorage().getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeOnceFlag(key: string, getStorage: () => Storage = pageStorage): void {
  try {
    getStorage().setItem(key, "1");
  } catch {
    // Storage refused the write: the flag stays unset, nothing else changes.
  }
}
