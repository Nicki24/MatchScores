// Construit l'assistant flottant (exécuté sur bet261.mg) :
//  - public/assistant.js             : script chargé par le favori « léger »
//  - lib/generated/assistant-code.ts : code embarqué (favori « autonome » et userscript)
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

const result = await build({
  entryPoints: ["assistant/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  define: { __APP_URL__: JSON.stringify(appUrl) },
});
const code = result.outputFiles[0].text;

mkdirSync("public", { recursive: true });
mkdirSync("lib/generated", { recursive: true });
writeFileSync("public/assistant.js", code);
writeFileSync("lib/generated/assistant-code.ts", `// Fichier généré — ne pas modifier.\nexport const ASSISTANT_CODE = ${JSON.stringify(code)};\n`);
console.log(`assistant: ${(code.length / 1024).toFixed(1)} Ko`);
