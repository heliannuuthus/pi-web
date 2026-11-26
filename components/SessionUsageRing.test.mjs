import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});

const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { SessionUsageRing, computeUsageRingSegments, RING_CIRCUMFERENCE } = await jiti.import("./SessionUsageRing.tsx");

test("computeUsageRingSegments renders three idle preview arcs when no tokens are recorded yet", () => {
  const { segments, isIdle } = computeUsageRingSegments(null);
  assert.equal(isIdle, true);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((s) => s.key), ["input", "cacheRead", "output"]);
});

test("computeUsageRingSegments keeps small token categories visibly represented alongside huge cache reads", () => {
  const { segments, isIdle } = computeUsageRingSegments({
    input: 326_000,
    output: 28_000,
    cacheRead: 5_700_000,
    cacheWrite: 0,
    total: 6_054_000,
  });
  assert.equal(isIdle, false);
  assert.deepEqual(segments.map((s) => s.key), ["input", "cacheRead", "output"]);

  const byKey = Object.fromEntries(segments.map((s) => [s.key, s]));
  assert.ok(byKey.cacheRead.visualWeight > byKey.input.visualWeight);
  assert.ok(byKey.input.visualWeight > byKey.output.visualWeight);
  // Output is <0.5% of raw tokens, yet dampened weighting keeps its arc >8% of the ring so all colors stay distinct.
  assert.ok(byKey.output.visualWeight > 0.08, `expected output visualWeight > 0.08, got ${byKey.output.visualWeight}`);
  for (const seg of segments) {
    const [len] = seg.dashArray.split(" ").map(Number);
    assert.ok(len > 2 && len < RING_CIRCUMFERENCE);
  }
});

test("SessionUsageRing SSR markup exposes the accessible Session info button and multi-color SVG ring", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(SessionUsageRing, {
        controlSize: 32,
        sessionStats: {
          sessionId: "sess-123",
          userMessages: 3,
          assistantMessages: 3,
          toolCalls: 8,
          toolResults: 8,
          totalMessages: 14,
          tokens: { input: 120_000, output: 14_000, cacheRead: 2_400_000, cacheWrite: 18_000, total: 2_552_000 },
          cost: 1.42,
        },
        contextUsage: { percent: 18.4, contextWindow: 1_000_000, tokens: 184_000 },
      }),
    ),
  );
  assert.match(html, /aria-label="Session info"/);
  assert.match(html, /class="session-usage-ring-btn"/);
  assert.match(html, /var\(--ring-input/);
  assert.match(html, /var\(--ring-cache-read/);
  assert.match(html, /var\(--ring-cache-write/);
  assert.match(html, /var\(--ring-output/);
});
