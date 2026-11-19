import { describe, expect, it, vi } from "vitest";
import { isValidElement, type HTMLAttributes, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { presetReachCaveat } from "@/features/isochrones/preset-view";
import { TRANSIT_NOTE } from "@/features/map/copy";
import { BASEMAP_CREDITS, TRANSITOUS_SOURCES_URL } from "@/features/map/credits";
import InfoControl, { INFO_AUTO_OPEN_MS } from "@/features/map/InfoControl";
import type { Mode } from "@/features/map/selection-flow";

const noop = () => {};

function render(open: boolean, mode: Mode, transitState: boolean): string {
  return renderToStaticMarkup(<InfoControl open={open} onOpenChange={noop} mode={mode} transitState={transitState} />);
}

/** The opening tag of the element carrying `data-testid`, or "" when absent. */
function openTag(html: string, testId: string): string {
  return html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

/** The popover's markup, from its opening tag to the end of the render. */
function popover(html: string): string {
  const tag = openTag(html, "info-popover");
  return tag ? html.slice(html.indexOf(tag)) : "";
}

/** Visible text: the markup with every tag (and React's text separators) removed. */
function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/** Every `<a>` opening tag in the markup. */
function links(html: string): string[] {
  return html.match(/<a [^>]*>/g) ?? [];
}

const BASEMAP_LINE = "© OpenStreetMap · ESA WorldCover (CC BY 4.0), modificat, via Daylight · Natural Earth";

type Props = HTMLAttributes<HTMLElement> & { "data-testid"?: string };

/** The first element in a tree matching `pick` (InfoControl has no hooks, so it can be called directly). */
function find(node: ReactNode, pick: (el: ReactElement<Props>) => boolean): ReactElement<Props> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, pick);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<Props>;
  if (pick(el)) return el;
  return find(el.props.children, pick);
}

describe("InfoControl", () => {
  it("auto-opens for five seconds", () => {
    expect(INFO_AUTO_OPEN_MS).toBe(5000);
  });

  it("closed: one 44px button labelled 'Despre estimări și surse', aria-expanded false, no popover", () => {
    const html = render(false, "walk", false);
    expect(html.match(/<button/g)).toHaveLength(1);
    const button = openTag(html, "info-button");
    expect(button).toContain('aria-label="Despre estimări și surse"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).toContain('aria-controls="info-popover"');
    expect(button).toMatch(/class="[^"]*\bsize-11\b/);
    expect(button).toMatch(/class="[^"]*\bhf-floating\b/);
    // The icon sits in a 32 px circle inside the 44 px target.
    expect(html).toMatch(/<span[^>]*class="[^"]*\bsize-8\b[^"]*"[^>]*><svg/);
    expect(html).not.toContain('data-testid="info-popover"');
    expect(html).not.toContain('role="dialog"');
    expect(links(html)).toEqual([]);
  });

  it("open on transit: caveat, transit note, the exact credit line and every credit link incl. Transitous", () => {
    const html = render(true, "transit", true);
    expect(openTag(html, "info-button")).toContain('aria-expanded="true"');
    const panel = openTag(html, "info-popover");
    expect(panel).toContain('id="info-popover"');
    expect(panel).toContain('role="dialog"');
    expect(panel).toContain('aria-label="Despre estimări și surse"');
    const body = text(popover(html));
    // The estimate mark, then the caveat; the note follows it, the credits come last.
    expect(body).toContain(`~${presetReachCaveat("transit")}`);
    expect(body.indexOf(presetReachCaveat("transit"))).toBeLessThan(body.indexOf(TRANSIT_NOTE));
    expect(body.indexOf(TRANSIT_NOTE)).toBeLessThan(body.indexOf(BASEMAP_LINE));
    expect(body).toContain(`${BASEMAP_LINE} · Transitous`);
    const hrefs = links(popover(html)).map((a) => a.match(/href="([^"]+)"/)?.[1]);
    expect(hrefs).toEqual([...Object.values(BASEMAP_CREDITS).map((c) => c.href), TRANSITOUS_SOURCES_URL]);
    for (const [label, href] of [
      ...Object.values(BASEMAP_CREDITS).map((c) => [c.label, c.href] as const),
      ["Transitous", TRANSITOUS_SOURCES_URL] as const,
    ]) {
      expect(popover(html)).toMatch(new RegExp(`<a [^>]*href="${href}"[^>]*>${label}</a>`));
    }
    // Every credit opens in a new tab without passing the page as referrer.
    for (const a of links(popover(html))) {
      expect(a).toContain('target="_blank"');
      expect(a).toContain('rel="noreferrer"');
    }
  });

  it("open on walk: walk caveat, no note, no Transitous link", () => {
    const html = render(true, "walk", false);
    const body = text(popover(html));
    expect(body).toContain(`~${presetReachCaveat("walk")}`);
    expect(body).not.toContain(TRANSIT_NOTE);
    expect(body.endsWith(BASEMAP_LINE)).toBe(true);
    expect(html).not.toContain("Transitous");
    expect(links(popover(html))).toHaveLength(5);
  });

  it("open on car: the traffic caveat, no note, no Transitous link", () => {
    const html = render(true, "car", false);
    const body = text(popover(html));
    expect(body).toContain(`~${presetReachCaveat("car")}`);
    expect(body).not.toContain(TRANSIT_NOTE);
    expect(html).not.toContain("Transitous");
  });

  it("the button toggles the popover", () => {
    const onOpenChange = vi.fn();
    const click = (open: boolean) => {
      const button = find(InfoControl({ open, onOpenChange, mode: "walk", transitState: false }), (el) => el.type === "button");
      if (!button) throw new Error("no info button");
      (button.props as { onClick: (e: unknown) => void }).onClick({ currentTarget: { dataset: {} } });
    };
    click(false);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    click(true);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("a press that starts on a closed popover opens it, even if it opened in between (the press blurred the address field)", () => {
    const onOpenChange = vi.fn();
    const button = (open: boolean) => {
      const el = find(InfoControl({ open, onOpenChange, mode: "walk", transitState: false }), (e) => e.type === "button");
      if (!el) throw new Error("no info button");
      return el.props as { onPointerDown: (e: unknown) => void; onClick: (e: unknown) => void };
    };
    const target = { dataset: {} as Record<string, string | undefined> };
    // Pressed while closed; the first-load popover opens before the click lands.
    button(false).onPointerDown({ currentTarget: target });
    button(true).onClick({ currentTarget: target });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    // The press is used once: a keyboard click afterwards toggles from the shown state.
    button(true).onClick({ currentTarget: target });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    // A press on an open popover closes it.
    button(true).onPointerDown({ currentTarget: target });
    button(true).onClick({ currentTarget: target });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("an aborted press leaves no intent behind, so the next keyboard click toggles", () => {
    const onOpenChange = vi.fn();
    const props = (open: boolean) => {
      const el = find(InfoControl({ open, onOpenChange, mode: "walk", transitState: false }), (e) => e.type === "button");
      if (!el) throw new Error("no info button");
      return el.props as Record<"onPointerDown" | "onPointerCancel" | "onPointerLeave" | "onBlur" | "onClick", (e: unknown) => void>;
    };
    const aborts: Array<[string, (target: unknown) => void]> = [
      ["pointercancel", (currentTarget) => props(false).onPointerCancel({ currentTarget })],
      ["leaving while still pressed", (currentTarget) => props(false).onPointerLeave({ currentTarget, buttons: 1 })],
      ["blur", (currentTarget) => props(false).onBlur({ currentTarget })],
    ];
    for (const [name, abort] of aborts) {
      onOpenChange.mockClear();
      const target = { dataset: {} as Record<string, string | undefined> };
      props(false).onPointerDown({ currentTarget: target });
      abort(target);
      expect(target.dataset.intent, name).toBeUndefined();
      // A keyboard click while the popover is open closes it; a stale "open" intent would not.
      props(true).onClick({ currentTarget: target });
      expect(onOpenChange, name).toHaveBeenLastCalledWith(false);
    }
  });

  it("a touch lifting off the button before its click keeps the press's intent", () => {
    const onOpenChange = vi.fn();
    const el = find(InfoControl({ open: true, onOpenChange, mode: "walk", transitState: false }), (e) => e.type === "button");
    const props = el?.props as Record<"onPointerDown" | "onPointerLeave" | "onClick", (e: unknown) => void>;
    const target = { dataset: {} as Record<string, string | undefined> };
    props.onPointerDown({ currentTarget: target });
    props.onPointerLeave({ currentTarget: target, buttons: 0 });
    expect(target.dataset.intent).toBe("close");
  });

  it("Escape closes an open popover and returns focus to the button; other keys and a closed popover are left alone", () => {
    const onOpenChange = vi.fn();
    const focus = vi.fn();
    const querySelector = vi.fn(() => ({ focus }));
    const preventDefault = vi.fn();
    const press = (open: boolean, key: string) => {
      const root = find(InfoControl({ open, onOpenChange, mode: "walk", transitState: false }), (el) => typeof el.props.onKeyDown === "function");
      if (!root) throw new Error("no key handler");
      root.props.onKeyDown?.({ key, currentTarget: { querySelector }, preventDefault } as never);
    };
    press(true, "Enter");
    press(false, "Escape");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();
    // Not handled here, so the Escape is still free to close the directions.
    expect(preventDefault).not.toHaveBeenCalled();
    press(true, "Escape");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(querySelector).toHaveBeenCalledWith('[data-testid="info-button"]');
    expect(focus).toHaveBeenCalledTimes(1);
    // Marked handled: the directions sheet underneath leaves this Escape alone.
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
