// Copie l'interface (dist/app) et le collecteur (dist/collector.js) dans les assets de l'APK.
import { cpSync, mkdirSync, rmSync } from "node:fs";

const assets = "android/app/src/main/assets";
rmSync(`${assets}/app`, { recursive: true, force: true });
mkdirSync(assets, { recursive: true });
cpSync("dist/app", `${assets}/app`, { recursive: true });
cpSync("dist/collector.js", `${assets}/collector.js`);
console.log("assets Android à jour");
