import type { ReactNode } from "react";
import { useId } from "react";

export const inputStyle = "min-h-11 w-full min-w-0 rounded-lg border border-[#c5d3ca] bg-white px-3 py-2 text-base text-[#16302c] outline-none focus-visible:border-[#3f705e] focus-visible:ring-2 focus-visible:ring-[#b8d5c5] aria-invalid:border-[#a63624]";

type FieldAttributes = {
  id: string;
  className: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
};

export function FormField({ label, error, children }: {
  label: string;
  error?: string;
  children: (attributes: FieldAttributes) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">{label}</label>
      {children({ id, className: inputStyle, "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined })}
      {error && <p id={`${id}-error`} className="text-sm text-[#8f3023]">{error}</p>}
    </div>
  );
}
