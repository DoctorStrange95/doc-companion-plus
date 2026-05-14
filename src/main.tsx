import { RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";
import { getRouter } from "./router";
import "./styles.css";

// Fire a keep-alive ping as early as possible — before React mounts — so the
// Render free-tier backend starts waking up the moment the JS bundle loads.
// This cuts the perceived cold-start delay on hard refresh significantly.
const _backendBase = (import.meta.env.VITE_BACKEND_URL ?? "").replace(/\/$/, "");
fetch(`${_backendBase}/api/health`).catch(() => {});

const router = getRouter();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />,
);
