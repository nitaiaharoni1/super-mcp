import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/*
 * Not every button is primary. `default` carries the one page-level intent
 * (request a key). `quiet` is the underlined text link that replaced the second
 * competing pill in the hero, so the eye has somewhere obvious to land.
 */
const buttonVariants = cva(
  [
    "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] px-6",
    "text-sm font-semibold",
    "transition-[background-color,color,border-color,transform] duration-150 ease-out",
    "active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-deep)]",
        secondary:
          "bg-[var(--color-paper-sunk)] text-[var(--color-ink)] hover:bg-[var(--color-accent-soft)]",
        outline:
          "border border-[var(--color-line-strong)] bg-[var(--color-paper-raised)] text-[var(--color-ink)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
        quiet:
          "px-1 text-[var(--color-ink)] underline decoration-[var(--color-line-strong)] decoration-1 underline-offset-[6px] hover:text-[var(--color-accent)] hover:decoration-[var(--color-accent)]",
        onBand: "bg-[var(--color-band-ink)] text-[var(--color-accent-deep)] hover:bg-white",
      },
      size: {
        default: "",
        sm: "h-9 px-4",
        lg: "h-12 px-7 text-base",
        xl: "h-14 px-9 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { buttonVariants };
