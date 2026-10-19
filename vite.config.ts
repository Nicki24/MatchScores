import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// L'interface est embarquée dans l'APK (assets/app/) : chemins relatifs obligatoires.
export default defineConfig({
  root: "app",
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../dist/app", emptyOutDir: true, target: "es2020" },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
});
