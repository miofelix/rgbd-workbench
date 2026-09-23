import React from "react";
import { createRoot, type Root } from "react-dom/client";

const TemporaryRoot = (): React.JSX.Element => (
  <div data-testid="rgbd-lab-root">RGB-D Lab</div>
);

export function mountRgbdLab(element: HTMLElement = document.getElementById("root")!): Root {
  const root = createRoot(element);
  root.render(<TemporaryRoot />);
  return root;
}

if (document.getElementById("root")) {
  mountRgbdLab();
}
