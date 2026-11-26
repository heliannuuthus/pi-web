import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { SegmentedTrack } = await jiti.import("./SegmentedControl.tsx");

const h = React.createElement;

test("SegmentedTrack renders SSR-clean segmented and ghost tracks without hydration mismatch", () => {
  const segHtml = renderToStaticMarkup(
    h(
      SegmentedTrack,
      { variant: "segmented", role: "group", "aria-label": "Controls" },
      h("button", { type: "button", className: "apple-segment", "aria-pressed": true }, "System"),
      h("button", { type: "button", className: "apple-segment", "aria-pressed": false }, "Tools"),
    ),
  );
  assert.match(segHtml, /^<div role="group" aria-label="Controls" class="apple-segmented">/);
  assert.doesNotMatch(segHtml, /data-glider-ready|apple-glider-thumb/);

  const ghostHtml = renderToStaticMarkup(
    h(
      SegmentedTrack,
      { variant: "ghost" },
      h("button", { type: "button", className: "apple-glass-pill-btn" }, "History"),
    ),
  );
  assert.match(ghostHtml, /^<div class="apple-toolbar-actions">/);
});
