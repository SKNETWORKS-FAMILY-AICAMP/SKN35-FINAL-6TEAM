import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Demo } from "./features/consultation/demo/Demo";
import { DEMO_URL, type DemoView } from "./features/consultation/demo/view";
import "./app/app.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root 요소가 없습니다");

const state = document.getElementById("demo-state");
if (state) {
  const view: DemoView = JSON.parse(state.textContent || "");
  document.title = "PC 맞춤 상담 · BUILDWISE";
  createRoot(root).render(
    <StrictMode>
      <Demo view={view} />
    </StrictMode>,
  );
} else if (new URLSearchParams(window.location.search).get("rag") === "1") {
  window.location.replace(DEMO_URL);
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
