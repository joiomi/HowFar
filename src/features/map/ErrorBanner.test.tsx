import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import ErrorBanner from "@/features/map/ErrorBanner";

const noop = () => {};

/** The opening tag of the element carrying `data-testid`, or "" when absent. */
function openTag(html: string, testId: string): string {
  return html.match(new RegExp(`<[a-z]+[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
}

/** The markup between a button's opening tag and its closing tag. */
function buttonInner(html: string, testId: string): string {
  const tag = openTag(html, testId);
  const start = html.indexOf(tag) + tag.length;
  return html.slice(start, html.indexOf("</button>", start));
}

type ButtonElement = ReactElement<ButtonHTMLAttributes<HTMLButtonElement> & { "data-testid"?: string }>;

/** Every `<button>` in an element tree (ErrorBanner has no hooks, so it can be called directly). */
function buttons(node: ReactNode): ButtonElement[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement(node)) return [];
  if (node.type === "button") return [node as ButtonElement];
  return buttons((node.props as { children?: ReactNode }).children);
}

// Static server render: the banner is presentation over its props, so the markup is its contract.
describe("ErrorBanner", () => {
  it("is an alert with a warning icon, the message and a 44px ↻ labelled Reîncearcă", () => {
    const html = renderToStaticMarkup(<ErrorBanner message="Nu am găsit adresa." onRetry={noop} />);
    const root = openTag(html, "error-banner");
    expect(html.startsWith(root)).toBe(true);
    expect(root).toContain('role="alert"');
    // The warning triangle, tinted with the warning colour and hidden from assistive tech.
    expect(html).toMatch(/<span[^>]*text-\[var\(--hf-warning\)\][^>]*><svg[^>]*aria-hidden="true"[^>]*><path d="M10\.3 4\.2/);
    expect(html).toContain(">Nu am găsit adresa.</p>");
    const retry = openTag(html, "banner-retry");
    expect(retry).toContain('type="button"');
    expect(retry).toContain('aria-label="Reîncearcă"');
    expect(retry).toMatch(/\bsize-11\b/);
    // The ↻ icon: the clockwise arrow's head.
    expect(buttonInner(html, "banner-retry")).toContain('d="M20 3.5v5h-5"');
    // One row, read in order: the message, then its action.
    expect(html.indexOf("Nu am găsit adresa.")).toBeLessThan(html.indexOf("banner-retry"));
  });

  it("offers the walk switch only when given", () => {
    const without = renderToStaticMarkup(<ErrorBanner message="Ceva nu a mers." onRetry={noop} />);
    expect(without).not.toContain("banner-walk");
    expect(without).not.toContain("Treci la mersul pe jos");

    const html = renderToStaticMarkup(
      <ErrorBanner message="Nu am putut calcula zona cu transportul public." onRetry={noop} onSwitchToWalk={noop} />,
    );
    const walk = openTag(html, "banner-walk");
    expect(walk).toContain('type="button"');
    expect(walk).toContain('aria-label="Treci la mersul pe jos"');
    expect(walk).toMatch(/\bsize-11\b/);
    // The walking figure's head.
    expect(buttonInner(html, "banner-walk")).toContain('<circle cx="13.5" cy="4" r="1.9"></circle>');
    // Retry first, then the way out.
    expect(html.indexOf("banner-retry")).toBeLessThan(html.indexOf("banner-walk"));
  });

  it("each button reports to its own handler", () => {
    const onRetry = vi.fn();
    const onSwitchToWalk = vi.fn();
    const found = buttons(ErrorBanner({ message: "m", onRetry, onSwitchToWalk }));
    const click = (testId: string) => {
      const button = found.find((b) => b.props["data-testid"] === testId);
      if (!button) throw new Error(`no ${testId} button`);
      button.props.onClick?.({} as never);
    };
    click("banner-retry");
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onSwitchToWalk).not.toHaveBeenCalled();
    click("banner-walk");
    expect(onSwitchToWalk).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
