import { describe, expect, it } from "vitest";

import {
  clearsLocateFailure,
  LOCATE_MESSAGES,
  LOCATE_TIMEOUT_MS,
  LocateError,
  locateOnce,
  locateRetryable,
} from "@/features/map/locate";
import type { SelectionAction } from "@/features/map/selection-flow";

type Success = PositionCallback;
type Failure = PositionErrorCallback;

/** A geolocation whose single reading is decided by `respond`; records the options it was asked with. */
function fakeGeo(respond: (ok: Success, fail: Failure) => void) {
  const calls: PositionOptions[] = [];
  const geo = {
    getCurrentPosition: (ok: Success, fail?: Failure | null, options?: PositionOptions) => {
      calls.push(options ?? {});
      respond(ok, fail as Failure);
    },
  };
  return { geo, calls };
}

const position = (latitude: number, longitude: number) => ({ coords: { latitude, longitude } }) as GeolocationPosition;
const failure = (code: number) => ({ code }) as GeolocationPositionError;

describe("locateOnce", () => {
  it("resolves the position and asks once with sane options", async () => {
    const { geo, calls } = fakeGeo((ok) => ok(position(44.43, 26.1)));
    await expect(locateOnce(geo)).resolves.toEqual({ lat: 44.43, lng: 26.1 });
    expect(calls).toEqual([{ enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }]);
    expect(LOCATE_TIMEOUT_MS).toBe(10_000);
  });

  it.each([
    [1, "denied"],
    [2, "unavailable"],
    [3, "timeout"],
  ] as const)("maps error code %i to %s", async (code, reason) => {
    const { geo } = fakeGeo((_ok, fail) => fail(failure(code)));
    const error = await locateOnce(geo).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LocateError);
    expect((error as LocateError).reason).toBe(reason);
  });

  it("treats an unknown error code as unavailable", async () => {
    const { geo } = fakeGeo((_ok, fail) => fail(failure(99)));
    await expect(locateOnce(geo)).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("reports a missing API as unsupported", async () => {
    await expect(locateOnce(undefined)).rejects.toMatchObject({ reason: "unsupported" });
  });

  it("reports a synchronous throw from the browser as unavailable", async () => {
    const geo = {
      getCurrentPosition: () => {
        throw new Error("blocked by policy");
      },
    };
    await expect(locateOnce(geo)).rejects.toMatchObject({ reason: "unavailable" });
  });
});

describe("LOCATE_MESSAGES", () => {
  it("speaks Romanian", () => {
    expect(LOCATE_MESSAGES).toEqual({
      denied: "Locația e blocată în browser.",
      unavailable: "Nu am putut afla locația ta.",
      timeout: "Nu am putut afla locația ta.",
      unsupported: "Locația nu e disponibilă pe acest dispozitiv.",
    });
  });
});

describe("locateRetryable", () => {
  it("offers ↻ only where asking again can succeed", () => {
    // A refused permission and a browser without location fail the same way again.
    expect(locateRetryable("denied")).toBe(false);
    expect(locateRetryable("unsupported")).toBe(false);
    // No fix yet, or not in time: the next try may get one.
    expect(locateRetryable("unavailable")).toBe(true);
    expect(locateRetryable("timeout")).toBe(true);
  });
});

describe("clearsLocateFailure", () => {
  it("a new place, ✕, and a mode, pace or time change retire a stored locate failure", () => {
    const clearing: SelectionAction[] = [
      { type: "start", mode: "walk" },
      { type: "start", mode: "walk", preserveLast: true },
      { type: "clear" },
      { type: "toggle", next: "transit" },
      { type: "setPace", pace: "slow" },
      { type: "setTimeContext", timeContext: { kind: "preset", preset: "quiet" } },
    ];
    for (const action of clearing) expect(clearsLocateFailure(action), action.type).toBe(true);
  });

  it("a selection settling leaves it: it is not something the user did", () => {
    const settling: SelectionAction[] = [
      { type: "resolved", token: 1, origin: { lat: 44.4, lng: 26.1 }, label: "x" },
      { type: "failed", token: 1, stage: "isochrone", httpStatus: 502 },
      { type: "crash", token: 1 },
    ];
    for (const action of settling) expect(clearsLocateFailure(action), action.type).toBe(false);
  });
});
