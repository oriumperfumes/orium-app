// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Determinístico entre bundles cliente/servidor; muda quando o app muda. */
function appBuildId(): string {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const hash = createHash("sha256");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        hash.update(relative(root, path));
        hash.update("|");
        hash.update(readFileSync(path));
        hash.update("|");
      }
    }
  };
  walk(join(root, "src"));
  walk(join(root, "public"));
  hash.update(readFileSync(join(root, "package.json")));
  return hash.digest("hex").slice(0, 20);
}

const buildId = appBuildId();

export default defineConfig({
  vite: { define: { __ORIUM_BUILD_ID__: JSON.stringify(buildId) } },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
