import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./styles/solar.css";
import "./styles/light.css";
import "./styles/nebula.css";
import App from "./app/App";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
