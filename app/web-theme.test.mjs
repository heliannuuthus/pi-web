import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { GET, dynamic } = await jiti.import("./web-theme.css/route.ts");

test("web-theme.css serves user overrides from PI_CODING_AGENT_DIR with no-store caching", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-theme-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  assert.equal(dynamic, "force-dynamic");

  const missing = await GET();
  assert.equal(missing.status, 200);
  assert.equal(missing.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal(await missing.text(), "");

  const customCss = ":root { --accent: oklch(0.52 0.22 264); }\n";
  await writeFile(join(dir, "web-theme.css"), customCss, "utf8");
  const loaded = await GET();
  assert.equal(await loaded.text(), customCss);
});
