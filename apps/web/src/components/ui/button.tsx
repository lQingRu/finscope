import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

// Based on the shadcn/ui Button, with the workspace's two variants.
const buttonVariants = cva(
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3f705e] disabled:cursor-not-allowed disabled:opacity-55",
  {
    variants: {
      variant: {
        default: "bg-[#17382f] text-white hover:bg-[#245144]",
        outline: "border border-[#ccd8d1] bg-white text-[#18372e] hover:bg-[#f1f6f2]",
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
