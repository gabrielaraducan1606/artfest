import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// CSS global minimal (poți adăuga Tailwind sau alt framework ulterior)
import "./styles/variables.css";

// montează aplicația în <div id="root"></div> din index.html
const root = createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
