export type Variant = "primary" | "secondary" | "danger" | "ghost" | "danger-ghost";
export type Size = "sm" | "md";

// Primary is inverted ink: the strongest thing on screen is always something you can press.
export const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-85 active:opacity-75",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-raised active:bg-line",
  danger: "bg-down text-white hover:opacity-90 active:opacity-80",
  ghost: "text-muted hover:bg-raised hover:text-ink active:bg-line",
  "danger-ghost": "text-down hover:bg-down-bg active:opacity-80",
};
const SIZES: Record<Size, string> = { sm: "h-8 gap-1.5 px-2.5 text-sm", md: "h-9 gap-2 px-3.5 text-[15px]" };

export function buttonClass(variant: Variant = "secondary", size: Size = "md", extra = "") {
  return `inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium transition-[background-color,opacity,color] duration-150 disabled:pointer-events-none disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}
