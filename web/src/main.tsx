import React from "react";
import { createRoot, type Root } from "react-dom/client";

import { App } from "./app/App";
import "./app/app.css";

export function mountRgbdLab(element: HTMLElement = document.getElementById("root")!): Root {
  const root = createRoot(element);
  root.render(<App />);
  return root;
}

if (document.getElementById("root")) {
  mountRgbdLab();
}
