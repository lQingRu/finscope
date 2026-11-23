import type { ReactNode } from "react";

export function Metric({ label, children, featured, tone }: {
  label: string;
  children: ReactNode;
  featured?: boolean;
  tone?: "positive" | "negative";
}) {
  return (
    <div className="ui-card ui-metric" data-featured={featured}>
      <dt>{label}</dt>
      <dd data-tone={tone}>{children}</dd>
    </div>
  );
}

export function StateMessage({ kind, className, children }: {
  kind: "loading" | "empty" | "error" | "success";
  className?: string;
  children: ReactNode;
}) {
  const role = kind === "error" ? "alert" : kind === "empty" ? undefined : "status";
  return <p className={["ui-state", className].filter(Boolean).join(" ")} data-kind={kind} role={role}>{children}</p>;
}
