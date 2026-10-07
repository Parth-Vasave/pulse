import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (p: P) => ({
  width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, ...p,
});

export const PlusIcon = (p: P) => <svg {...base(p)}><path d="M8 3v10M3 8h10" /></svg>;
export const PauseIcon = (p: P) => <svg {...base(p)}><path d="M5.5 3.5v9M10.5 3.5v9" /></svg>;
export const PlayIcon = (p: P) => <svg {...base(p)}><path d="M5 3.5l7 4.5-7 4.5z" /></svg>;
export const PencilIcon = (p: P) => <svg {...base(p)}><path d="M10.5 3.5l2 2L5 13l-2.8.8L3 11z" /></svg>;
export const TrashIcon = (p: P) => <svg {...base(p)}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" /></svg>;
export const CopyIcon = (p: P) => <svg {...base(p)}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5V4A1.5 1.5 0 009 2.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5" /></svg>;
export const CheckIcon = (p: P) => <svg {...base(p)}><path d="M3 8.5l3.2 3L13 4.5" /></svg>;
export const RefreshIcon = (p: P) => <svg {...base(p)}><path d="M13 8a5 5 0 11-1.5-3.6M13 2.5v3h-3" /></svg>;
export const SendIcon = (p: P) => <svg {...base(p)}><path d="M14 2L7 9M14 2l-4.5 12-2-5-5-2z" /></svg>;
export const ExternalIcon = (p: P) => <svg {...base(p)}><path d="M9 3h4v4M13 3L7.5 8.5M11.5 9.5V12a1 1 0 01-1 1H4a1 1 0 01-1-1V5.5a1 1 0 011-1h2.5" /></svg>;
export const ArrowLeftIcon = (p: P) => <svg {...base(p)}><path d="M13 8H3M7 4L3 8l4 4" /></svg>;
export const XIcon = (p: P) => <svg {...base(p)}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const ChevronDownIcon = (p: P) => <svg {...base(p)}><path d="M4 6l4 4 4-4" /></svg>;
export const AlertIcon = (p: P) => <svg {...base(p)}><path d="M8 5v3.5M8 11h.01M7 2.5L1.8 12a1 1 0 00.9 1.5h10.6a1 1 0 00.9-1.5L9 2.5a1 1 0 00-2 0z" /></svg>;

/** Check outcome marks, drawn so Passed/Failed never rely on colour or a text glyph. */
export const PassMark = (p: P) => <svg {...base({ width: 12, height: 12, strokeWidth: 1.8, ...p })}><path d="M3 8.5l3.2 3L13 4.5" /></svg>;
export const FailMark = (p: P) => <svg {...base({ width: 12, height: 12, strokeWidth: 1.8, ...p })}><path d="M4 4l8 8M12 4l-8 8" /></svg>;

/** The GitHub mark, filled, for links to the repository. */
export const GitHubIcon = (p: P) => (
  <svg {...base({ fill: "currentColor", stroke: "none", ...p })}>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

export const ArrowRightIcon = (p: P) => <svg {...base(p)}><path d="M3 8h10M9 4l4 4-4 4" /></svg>;
