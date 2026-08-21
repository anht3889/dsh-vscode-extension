import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("webview: #root mount node missing");
}
createRoot(container).render(<App />);
