import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./styles/solar.css";
import "./styles/light.css";
import "./styles/nebula.css";
import App from "./app/App";
import { wake } from "./lib/wake";

// Start waking the API as soon as the app boots; most visitors browse for a few seconds first.
wake();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
