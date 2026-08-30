import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoClient } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoClient />
  </StrictMode>,
);
