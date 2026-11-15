// Gera supabase/functions/sync-suppliers/index.ts (um arquivo só) a partir do motor do app.
// Uso: node scripts/build-edge-sync.mjs
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const clientShim = resolve(root, "supabase/edge-src/client.edge.ts");

const result = await build({
  entryPoints: [resolve(root, "supabase/edge-src/sync-suppliers.ts")],
  outfile: resolve(root, "supabase/functions/sync-suppliers/index.ts"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  legalComments: "none",
  // Minificado e sem o supabase-js embutido (a Deno o resolve via npm:): o arquivo vai inteiro pelo deploy.
  minify: true,
  logLevel: "warning",
  metafile: true,
  banner: {
    js: [
      "// GERADO por scripts/build-edge-sync.mjs — não edite. Fonte: supabase/edge-src/sync-suppliers.ts + src/lib/suppliers/*.",
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  plugins: [
    {
      name: "orium-alias",
      setup(b) {
        b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "npm:@supabase/supabase-js@2", external: true }));
        // Deno exige o prefixo node: nos módulos nativos do Node.
        b.onResolve({ filter: /^(crypto|buffer|path|url|util|stream|events|os|fs|http|https|zlib|net|tls|assert|string_decoder|querystring)$/ }, (a) => ({ path: "node:" + a.path, external: true }));
        b.onResolve({ filter: /^@\/integrations\/supabase\/client\.server$/ }, () => ({ path: clientShim }));
        b.onResolve({ filter: /^@\// }, (args) =>
          b.resolve("./" + args.path.slice(2), { resolveDir: resolve(root, "src"), kind: args.kind, importer: args.importer }),
        );
      },
    },
  ],
});
const inputs = Object.keys(result.metafile.inputs).filter((p) => !p.startsWith("node_modules"));
console.log("arquivos do projeto no pacote:", inputs.length);
