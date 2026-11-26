import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/app";
import "./app/styles/globals.css";
import "./features/financial-accounts/components/accounts.css";
import "./features/overview/overview.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Application root is missing");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
