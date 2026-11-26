import type { ReactNode } from "react";

export function StateMessage({ kind, className, children }: {
  kind: "loading" | "empty" | "error" | "success";
  className?: string;
  children: ReactNode;
}) {
  const role = kind === "error" ? "alert" : kind === "empty" ? undefined : "status";
  return <p className={["ui-state", className].filter(Boolean).join(" ")} data-kind={kind} role={role}>{children}</p>;
}
