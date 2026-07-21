import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] px-6 text-sm font-semibold transition-[opacity,transform,background-color] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-accent)] text-white hover:opacity-92",
        secondary:
          "bg-[var(--color-olive-soft)] text-[var(--color-ink)] hover:opacity-90",
        outline:
          "border border-[var(--color-line)] bg-white text-[var(--color-ink)] hover:bg-[var(--color-olive-soft)]",
        ghost: "bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-olive-soft)]",
        onBrand:
          "bg-white text-[var(--color-brand-band-deep)] hover:bg-white/92",
      },
      size: {
        default: "",
        sm: "h-9 px-4 text-sm",
        lg: "h-12 px-8 text-base",
        xl: "h-14 px-10 text-lg",
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
