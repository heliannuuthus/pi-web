import { open } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

const MAX_USER_THEME_BYTES = 256 * 1024;
const CSS_HEADERS = {
  "Content-Type": "text/css; charset=utf-8",
  "Cache-Control": "no-store",
};

/**
 * Serves optional user CSS overrides from `<agentDir>/web-theme.css`
 * (`~/.pi/agent/web-theme.css` by default, or `$PI_CODING_AGENT_DIR/web-theme.css`).
 * Missing or oversized files resolve cleanly to an empty stylesheet so reloads
 * pick up edits immediately without rebuilding Pi Web.
 */
export async function GET() {
  const themePath = join(getAgentDir(), "web-theme.css");
  let handle;
  try {
    handle = await open(themePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_USER_THEME_BYTES) {
      return new Response("", { headers: CSS_HEADERS });
    }
    const css = await handle.readFile("utf8");
    return new Response(css, { headers: CSS_HEADERS });
  } catch {
    return new Response("", { headers: CSS_HEADERS });
  } finally {
    await handle?.close().catch(() => {});
  }
}
