import { test } from "node:test";
import assert from "node:assert/strict";
import { findApiUrls, scriptUrls } from "../lib/extract/discover";
import { oddsInLabel } from "../lib/extract/normalize";

test("scripts d'une page coquille", () => {
  const html = `<script src="/static/js/main.abc.js"></script><script src="https://cdn.bet261.mg/app.js"></script>`;
  assert.deepEqual(scriptUrls(html, "https://bet261.mg"), ["https://bet261.mg/static/js/main.abc.js", "https://cdn.bet261.mg/app.js"]);
});

test("URL d'API dans un bundle JS", () => {
  const js = `const A="https://api.bet261.mg/";fetch("/api/v2/sports/events?lang=fr");const G="https://www.googletagmanager.com/gtm.js";const S="https://sport-feed.example.com/prematch/list";`;
  const r = findApiUrls(js, "https://bet261.mg");
  assert.ok(r.bases.includes("https://api.bet261.mg"));
  assert.ok(r.endpoints.includes("https://bet261.mg/api/v2/sports/events?lang=fr") || r.endpoints.some((e) => e.startsWith("https://bet261.mg/api/v2/sports/events")));
  assert.ok(r.endpoints.includes("https://sport-feed.example.com/prematch/list"));
  assert.ok(!r.endpoints.some((e) => e.includes("google")));
});

test("cotes dans un libellé de bouton", () => {
  assert.equal(oddsInLabel("1.85"), 1.85);
  assert.equal(oddsInLabel("X 3,40"), 3.4);
  assert.equal(oddsInLabel("Plus de 2.5 1.90"), 1.9);
  assert.equal(oddsInLabel("Arsenal"), undefined);
});
