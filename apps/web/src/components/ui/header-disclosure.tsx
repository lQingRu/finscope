import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { Button } from "./button";

export function HeaderDisclosure({ label, trigger, triggerClassName, triggerRef, children }: {
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const localTrigger = useRef<HTMLButtonElement>(null);
  const button = triggerRef ?? localTrigger;
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div
      ref={root}
      className="header-disclosure"
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <Button
        ref={button}
        variant="outline"
        className={triggerClassName}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </Button>
      <div id={id} hidden={!open} className="header-popover">
        {children(() => setOpen(false))}
      </div>
    </div>
  );
}
