// Rulare: node --test src/pages/Home/CollectionsSection/collectionCards.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { collectionPath, toCollectionCards } from "./collectionCards.js";

test("card cu link real către /colectii/:slug, titlu și imagine", () => {
  const cards = toCollectionCards([
    {
      slug: "nunta",
      title: "Nuntă",
      subtitle: "Idei pentru nuntă",
      heroImage: "https://cdn.artfest.ro/n.jpg",
    },
  ]);

  assert.deepEqual(cards, [
    {
      slug: "nunta",
      title: "Nuntă",
      subtitle: "Idei pentru nuntă",
      image: "https://cdn.artfest.ro/n.jpg",
      to: "/colectii/nunta",
    },
  ]);
});

test("resolveImage se aplică doar când există imagine", () => {
  const resolveImage = (u) => `https://api.artfest.ro${u}`;
  const [withImg, withoutImg] = toCollectionCards(
    [
      { slug: "a", title: "A", heroImage: "/u/a.jpg" },
      { slug: "b", title: "B", heroImage: "" },
    ],
    { resolveImage }
  );

  assert.equal(withImg.image, "https://api.artfest.ro/u/a.jpg");
  assert.equal(withoutImg.image, "");
});

test("rânduri fără slug/titlu, duplicate și non-obiecte sunt omise", () => {
  const cards = toCollectionCards([
    { slug: "ok", title: "Ok" },
    { slug: "", title: "Fără slug" },
    { slug: "fara-titlu", title: "  " },
    { slug: "ok", title: "Duplicat" },
    null,
    "string",
    { title: "Fără slug deloc" },
  ]);

  assert.deepEqual(
    cards.map((c) => c.slug),
    ["ok"]
  );
});

test("intrare invalidă => listă goală (secțiunea nu se randează)", () => {
  for (const input of [undefined, null, {}, "x", 5, []]) {
    assert.deepEqual(toCollectionCards(input), []);
  }
});

test("max limitează numărul de carduri", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    slug: `c${i}`,
    title: `C${i}`,
  }));
  assert.equal(toCollectionCards(items, { max: 12 }).length, 12);
});

test("collectionPath: aceeași formă ca canonical/sitemap", () => {
  assert.equal(collectionPath("nunta"), "/colectii/nunta");
  assert.equal(collectionPath("a b"), "/colectii/a%20b");
});
