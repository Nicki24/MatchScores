// Construit le script collecteur injecté dans la page bet261 par l'appli Android.
import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["app/src/collector/hook.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2017",
  outfile: "dist/collector.js",
  legalComments: "none",
});
console.log("collecteur : dist/collector.js");
