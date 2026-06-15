// Self-contained build → dist/host/{worker,manifest}.js + dist/ui/index.js.
// When dropped in-tree, switch to `createPluginBundlerPresets` from
// @paperclipai/plugin-sdk/bundlers (see the example plugins) so the SDK + host
// kit are externalized the way the host expects.
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const common = { bundle: true, sourcemap: true, logLevel: "info", target: "es2022" };

// The real SDK is resolved at runtime from the monorepo node_modules — keep it external.
const nodeExternal = ["@paperclipai/plugin-sdk"];
const targets = [
  { ...common, entryPoints: ["src/host/worker.ts"], outfile: "dist/host/worker.js", platform: "node", format: "esm", target: "node22", external: nodeExternal },
  { ...common, entryPoints: ["src/host/manifest.ts"], outfile: "dist/host/manifest.js", platform: "node", format: "esm", target: "node22", external: nodeExternal },
  {
    ...common,
    entryPoints: ["src/ui/index.tsx"],
    outfile: "dist/ui/index.js",
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    external: ["react", "react-dom", "react/jsx-runtime"],
  },
];

if (watch) {
  const ctxs = await Promise.all(targets.map((t) => esbuild.context(t)));
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log("esbuild watch enabled (worker, manifest, ui)");
} else {
  await Promise.all(targets.map((t) => esbuild.build(t)));
  console.log("built: dist/host/worker.js, dist/host/manifest.js, dist/ui/index.js");
}
