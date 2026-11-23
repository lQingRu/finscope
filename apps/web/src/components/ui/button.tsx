import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

// Based on the shadcn/ui Button, with the workspace button styles.
const buttonVariants = cva(
  "ui-button",
  {
    variants: {
      variant: {
        default: "bg-accent text-on-accent enabled:hover:bg-accent-hover",
        outline: "border border-control bg-surface text-ink enabled:hover:bg-surface-muted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Button({
  className,
  variant,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button data-slot="button" type={type} className={buttonVariants({ variant, className })} {...props} />;
}
