import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import SelectionCard from "@/features/map/SelectionCard";

// Static server render — pure presentation of the selection state.
describe("SelectionCard (phone-first — label, preset legend and explainer)", () => {
  it("shows the selected preset minute in the legend + the honest reach explainer", () => {
    const html = renderToStaticMarkup(
      <SelectionCard label="Str. Lipscani 5" message={null} mode="walk" selectedMin={20} loading={false} />,
    );
    expect(html).toContain("Str. Lipscani 5");
    expect(html).toContain("Walking");
    expect(html).toContain("≤ 20 min");
    expect(html).toContain("20-minute walk"); // the explainer names the served minute
  });

  it("leaves the caveat and the transit and car notes to the info popover", () => {
    for (const mode of ["walk", "transit", "car"] as const) {
      const html = renderToStaticMarkup(
        <SelectionCard label="X" message={null} mode={mode} selectedMin={20} loading={false} />,
      );
      expect(html).toContain("ring-explainer");
      expect(html).not.toContain("reach-caveat");
      expect(html).not.toContain("transit-departure-note");
      expect(html).not.toContain("car-estimate-note");
    }
  });

  it("renders the failure message as an alert, no legend", () => {
    const html = renderToStaticMarkup(
      <SelectionCard label={null} message="That spot is outside Bucharest." mode="walk" selectedMin={10} loading={false} />,
    );
    expect(html).toContain("That spot is outside Bucharest.");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("ring-explainer");
  });

  it("renders nothing when there is no label, message, or loading state", () => {
    const html = renderToStaticMarkup(
      <SelectionCard label={null} message={null} mode="walk" selectedMin={10} loading={false} />,
    );
    expect(html).toBe("");
  });
});
