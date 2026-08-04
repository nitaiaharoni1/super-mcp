import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/*
 * Not every button is primary. `default` (lime) carries the one page-level
 * intent (request a key), `secondary` is the same physical sticker in cream
 * for lower-stakes actions, and `quiet` is the underlined text link for
 * tertiary paths like the developer docs.
 */
const buttonVariants = cva(
  [
    "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-card)] px-6",
    "text-sm font-bold",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "pressable border-[3px] border-[var(--color-ink)] bg-[var(--color-lime)] text-[var(--color-ink)] shadow-sticker",
        secondary:
          "pressable border-[3px] border-[var(--color-ink)] bg-[var(--color-paper-raised)] text-[var(--color-ink)] shadow-sticker-sm hover:bg-[var(--color-lime-soft)]",
        quiet:
          "px-1 text-[var(--color-ink)] underline decoration-[var(--color-ink)] decoration-2 underline-offset-[6px] hover:text-[var(--color-grape-band)] hover:decoration-[var(--color-grape-band)]",
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
