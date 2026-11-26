import type { ReactNode } from "react";
import { useId } from "react";

export const inputStyle = "ui-input";

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
      {error && <p id={`${id}-error`} className="text-sm text-danger">{error}</p>}
    </div>
  );
}
