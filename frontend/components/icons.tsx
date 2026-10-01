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
