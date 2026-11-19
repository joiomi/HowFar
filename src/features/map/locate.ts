import type { SelectionAction } from "@/features/map/selection-flow";

/** The ways asking for the phone's position can fail. */
export type LocateFailure = "denied" | "unavailable" | "timeout" | "unsupported";

/** How long to wait for a fix before giving up. */
export const LOCATE_TIMEOUT_MS = 10_000;

/** A fix this recent is good enough: a place picked on foot does not need a fresh one. */
const LOCATE_MAX_AGE_MS = 60_000;

export const LOCATE_MESSAGES: Record<LocateFailure, string> = {
  denied: "Locația e blocată în browser.",
  unavailable: "Nu am putut afla locația ta.",
  timeout: "Nu am putut afla locația ta.",
  unsupported: "Locația nu e disponibilă pe acest dispozitiv.",
};

/**
 * Whether the failure banner offers ↻: only where asking again can succeed. A
 * refused permission, or a browser without location, fails the same way again.
 */
export function locateRetryable(reason: LocateFailure): boolean {
  return reason === "unavailable" || reason === "timeout";
}

/**
 * Whether a selection action retires a stored locate failure: a new place or ✕,
 * and a mode, pace or time change, so the banner never outlives what the user did
 * next. A selection settling (resolved, failed, crashed) is not something the user
 * did, and leaves it. A map tap retires it too, in the shell's click handler.
 */
export function clearsLocateFailure(action: SelectionAction): boolean {
  switch (action.type) {
    case "start":
    case "clear":
    case "toggle":
    case "setPace":
    case "setTimeContext":
      return true;
    default:
      return false;
  }
}

export class LocateError extends Error {
  readonly reason: LocateFailure;
  constructor(reason: LocateFailure) {
    super(LOCATE_MESSAGES[reason]);
    this.name = "LocateError";
    this.reason = reason;
  }
}

// GeolocationPositionError codes: 1 permission denied, 2 position unavailable, 3 timeout.
function reasonFor(code: number): LocateFailure {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

/** Reads the phone's position once. Rejects with a `LocateError` naming why it could not. */
export function locateOnce(
  geo: Pick<Geolocation, "getCurrentPosition"> | undefined,
): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!geo) {
      reject(new LocateError("unsupported"));
      return;
    }
    try {
      geo.getCurrentPosition(
        (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
        (error) => reject(new LocateError(reasonFor(error.code))),
        { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: LOCATE_MAX_AGE_MS },
      );
    } catch {
      reject(new LocateError("unavailable"));
    }
  });
}
