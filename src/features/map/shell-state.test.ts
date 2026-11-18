import { describe, expect, it } from "vitest";

import { deriveShell, EXPANDED_SHELL, type ShellInputs } from "@/features/map/shell-state";

const base: ShellInputs = {
  isMobile: true,
  userSheetExpanded: false,
  reachActive: false,
};

describe("deriveShell", () => {
  it("desktop is always fully expanded, whatever the flags say", () => {
    for (const userSheetExpanded of [true, false]) {
      for (const reachActive of [true, false]) {
        expect(deriveShell({ isMobile: false, userSheetExpanded, reachActive })).toEqual(EXPANDED_SHELL);
      }
    }
    expect(EXPANDED_SHELL).toEqual({ sheet: "expanded" });
  });

  it("the sheet peeks by default and expands on user request", () => {
    expect(deriveShell(base)).toEqual({ sheet: "peek" });
    expect(deriveShell({ ...base, userSheetExpanded: true }).sheet).toBe("expanded");
  });

  it("active directions force the sheet expanded (a journey answer never hides behind the peek bar)", () => {
    expect(deriveShell({ ...base, reachActive: true }).sheet).toBe("expanded");
    expect(deriveShell({ ...base, reachActive: true, userSheetExpanded: false }).sheet).toBe("expanded");
  });
});
