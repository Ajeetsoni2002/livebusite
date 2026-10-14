import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./styles/solar.css";
import "./styles/light.css";
import "./styles/nebula.css";
import App from "./app/App";
import { wake } from "./lib/wake";
import { playIntro } from "./intro/intro";

// The opening intro plays on every load of the home page only (never on staff or other routes).
if (location.pathname === "/") playIntro();
// Start waking the API as soon as the app boots; most visitors browse for a few seconds first.
wake();
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
