import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMatchesFromJson, extractEmbeddedJson } from "../lib/extract/json";
import { parseMatchesFromText, parseResultsFromText, parseStandingsFromText } from "../lib/extract/text";
import { parseForm } from "../lib/extract/normalize";

test("JSON : structure home/away + outcomes", () => {
  const data = {
    data: {
      sports: [
        {
          name: "Football",
          events: [
            {
              id: 1,
              homeTeam: { name: "Arsenal" },
              awayTeam: { name: "Chelsea" },
              markets: [
                { name: "1X2", outcomes: [{ name: "1", price: 1.8 }, { name: "X", price: 3.6 }, { name: "2", price: 4.5 }] },
                { name: "Total 2.5", outcomes: [{ name: "Over 2.5", price: 1.7 }, { name: "Under 2.5", price: 2.1 }] },
              ],
            },
          ],
        },
        { name: "Basketball", events: [{ name: "Lakers - Celtics", odds: [1.9, 1.9] }] },
      ],
    },
  };
  const ms = extractMatchesFromJson(data);
  assert.equal(ms.length, 2);
  const ars = ms.find((m) => m.home === "Arsenal")!;
  assert.equal(ars.sport, "football");
  assert.equal(ars.markets.find((m) => m.key === "1X2")?.selections[1].odds, 3.6);
  assert.equal(ars.markets.find((m) => m.key === "OU")?.line, 2.5);
  const lak = ms.find((m) => m.home === "Lakers")!;
  assert.equal(lak.sport, "basketball");
  assert.equal(lak.markets[0].key, "12");
});

test("JSON embarqué dans le HTML", () => {
  const html = `<script id="__NEXT_DATA__" type="application/json">{"e":[{"team1":"PSG","team2":"OM","odd1":"1.50","oddX":"4.2","odd2":"6"}]}</script>`;
  const ms = extractMatchesFromJson(extractEmbeddedJson(html));
  assert.equal(ms.length, 1);
  assert.equal(ms[0].markets[0].selections[0].odds, 1.5);
});

test("texte copié : une valeur par ligne", () => {
  const text = `Football\nAngleterre - Premier League\n20:45\nArsenal\nChelsea\n1.85\n3.40\n4.20\n+125\nLiverpool\nEverton\n1,35\n5,00\n8,50\nBasketball\nLakers\nCeltics\n1.95\n1.85`;
  const ms = parseMatchesFromText(text);
  assert.equal(ms.length, 3);
  assert.equal(ms[0].home, "Arsenal");
  assert.equal(ms[1].markets[0].selections[0].odds, 1.35);
  assert.equal(ms[2].sport, "basketball");
  assert.equal(ms[2].markets[0].key, "12");
});

test("texte copié : match sur une ligne", () => {
  const ms = parseMatchesFromText("Real Madrid - Getafe 1.30 5.40 9.50");
  assert.equal(ms.length, 1);
  assert.equal(ms[0].away, "Getafe");
});

test("classement, résultats et forme", () => {
  const text = `1 Londres Rouge 9 7 1 1 20 8 12 22 VVNVV\n2 Madrid Blanc 9 6 2 1 18 9 9 20 VNVDV\n3. Paris 9 5 2 2 15 10 5 17\nLondres Rouge 2 - 1 Paris\nMilan 0:0 Turin`;
  const st = parseStandingsFromText(text);
  assert.equal(st.length, 3);
  assert.equal(st[0].points, 22);
  assert.equal(st[0].goalsFor, 20);
  assert.deepEqual(st[1].form, ["W", "D", "W", "L", "W"]);
  const rs = parseResultsFromText(text);
  assert.equal(rs.length, 2);
  assert.equal(rs[1].awayGoals, 0);
  assert.deepEqual(parseForm("WDL"), ["W", "D", "L"]);
});
