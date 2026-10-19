import { defineConfig, devices } from "@playwright/test";

// Tests de bout en bout dans Chromium : site de test (journées de 20 s) + interface de l'appli.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { ...devices["Pixel 7"], locale: "fr-FR", timezoneId: "Indian/Antananarivo", trace: "retain-on-failure" },
  webServer: [
    {
      command: "npx tsx tools/mock-site/server.ts",
      url: "http://localhost:4173/truth.json",
      env: { PORT: "4173", ROUND_SECONDS: "20", LIVE_SECONDS: "4" },
      reuseExistingServer: false,
    },
    ...(process.env.E2E_NO_APP === "1"
      ? []
      : [
          {
            command: "npx vite preview --port 5173 --strictPort",
            url: "http://localhost:5173/",
            reuseExistingServer: false,
          },
        ]),
  ],
});
