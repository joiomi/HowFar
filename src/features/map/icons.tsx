import type { JSX, ReactNode } from "react";

/**
 * The shell's icon set: line drawings on a 24px grid, stroked in the current
 * text colour with round caps and joins, so a parent's `color` (or a mode
 * accent) tints them. Always decorative — the control that holds an icon
 * carries the accessible name.
 */

export type IconName =
  | "search"
  | "pin"
  | "x"
  | "locate"
  | "walk"
  | "bus"
  | "car"
  | "metro"
  | "tram"
  | "train"
  | "info"
  | "clock"
  | "turtle"
  | "hold"
  | "retry"
  | "warning"
  | "arrow";

const ICON_PATHS: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21.5s6.5-5.6 6.5-11.5a6.5 6.5 0 0 0-13 0c0 5.9 6.5 11.5 6.5 11.5z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22" />
    </>
  ),
  walk: (
    <>
      <circle cx="13.5" cy="4" r="1.9" />
      <path d="M10 21.5l2-6.3 3 2.9v3.4" />
      <path d="M12 15.2l-.8-5.4-3.3 2v3.2" />
      <path d="M11.2 9.8l3.3-1.3 1.9 3.2h2.9" />
    </>
  ),
  bus: (
    <>
      <rect x="5" y="3" width="14" height="15" rx="3" />
      <path d="M5 11h14M8 21v-3M16 21v-3" />
      <path d="M8.5 14.5h.01M15.5 14.5h.01" strokeWidth="2.6" />
    </>
  ),
  car: (
    <>
      <path d="M4.5 17h15v-4.6l-1.9-4.9A2 2 0 0 0 15.7 6H8.3a2 2 0 0 0-1.9 1.5L4.5 12.4z" />
      <path d="M4.5 12.4h15" />
      <path d="M8 14.8h.01M16 14.8h.01" strokeWidth="2.6" />
      <path d="M6.5 17v2.2M17.5 17v2.2" />
    </>
  ),
  metro: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7.5 16V8.5l4.5 5 4.5-5V16" />
    </>
  ),
  // Pantograph over a rounded car body, with the wheels splayed onto the rails.
  tram: (
    <>
      <path d="M8 2.5h8M12 2.5 10 6" />
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M6 12.5h12" />
      <path d="M9.5 15.3h.01M14.5 15.3h.01" strokeWidth="2.6" />
      <path d="M9 18l-1.5 3M15 18l1.5 3" />
    </>
  ),
  // Locomotive front: split windscreen, two lamps, rails converging below.
  train: (
    <>
      <rect x="5" y="3" width="14" height="14" rx="4" />
      <path d="M5 10h14M12 3v7" />
      <path d="M8.5 13.5h.01M15.5 13.5h.01" strokeWidth="2.6" />
      <path d="M8 21l2-4M16 21l-2-4" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.2" />
      <path d="M12 7.8h.01" strokeWidth="2.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  turtle: (
    <>
      <path d="M3 16a7.5 6.5 0 0 1 15 0z" />
      <path d="M7.2 16l1.6-4.6h3.9l1.6 4.6" />
      <path d="M18 14.6c1 0 1.6-.5 2.1-1.2" />
      <circle cx="20.6" cy="12.2" r="1.6" />
      <path d="M6 16v2.4M15.5 16v2.4M3 16l-1.2 1" />
    </>
  ),
  hold: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
    </>
  ),
  // Clockwise arc with its arrowhead at the top right.
  retry: (
    <>
      <path d="M20 12a8 8 0 1 1-8-8c2.2 0 4.2.9 5.7 2.3L20 8.5" />
      <path d="M20 3.5v5h-5" />
    </>
  ),
  // Rounded triangle with an exclamation mark.
  warning: (
    <>
      <path d="M10.3 4.2 2.8 17.5a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5V14" />
      <path d="M12 17.2h.01" strokeWidth="2.6" />
    </>
  ),
  arrow: <path d="M5 12h13M13 7l5 5-5 5" />,
};

export const ICON_NAMES: readonly IconName[] = Object.keys(ICON_PATHS) as IconName[];

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ name, size = 22, strokeWidth = 2, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
