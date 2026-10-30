import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));

await build({
  entryPoints: ["src/index.ts"],
  outfile: "plugin/server/index.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  minify: true,
  legalComments: "none",
  define: { __VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node" },
});
mkdirSync("extension/server", { recursive: true });
copyFileSync("plugin/server/index.cjs", "extension/server/index.cjs");
console.log(`Built plugin/server/index.cjs and extension/server/index.cjs (v${version})`);
