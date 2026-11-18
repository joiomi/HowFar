import { describe, expect, it } from "vitest";

import { HOLD_HINT_KEY, readOnceFlag, writeOnceFlag } from "@/features/map/once-flag";

/** A Map-backed stand-in for localStorage (the unit tests run without a DOM). */
function memStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("once flags in localStorage", () => {
  it("versions the hold hint's key", () => {
    expect(HOLD_HINT_KEY).toBe("hf:hold-hint:v1");
  });

  it("is unset until written, then set", () => {
    const s = memStorage();
    expect(readOnceFlag("k", () => s)).toBe(false);
    writeOnceFlag("k", () => s);
    expect(readOnceFlag("k", () => s)).toBe(true);
    expect(s.getItem("k")).toBe("1");
    // Another key stays unset, and so does a key holding anything but the flag's value.
    expect(readOnceFlag("other", () => s)).toBe(false);
    s.setItem("odd", "0");
    expect(readOnceFlag("odd", () => s)).toBe(false);
  });

  it("treats storage that throws on access, read or write as unset and never throws", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(readOnceFlag("k", blocked)).toBe(false);
    expect(() => writeOnceFlag("k", blocked)).not.toThrow();
    const bad = {
      getItem: () => {
        throw new Error("x");
      },
      setItem: () => {
        throw new Error("quota");
      },
    } as unknown as Storage;
    expect(readOnceFlag("k", () => bad)).toBe(false);
    expect(() => writeOnceFlag("k", () => bad)).not.toThrow();
  });

  it("falls back to the page's localStorage, and reads as unset where there is none", () => {
    // The unit tests run without a DOM: `window` is undefined, so the default
    // storage getter throws and both calls must swallow it.
    expect(readOnceFlag("k")).toBe(false);
    expect(() => writeOnceFlag("k")).not.toThrow();
  });
});
