// Rulare: node --test src/utils/sanitizeHtml.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { htmlToText, sanitizeHtml } from "./sanitizeHtml.js";

test("păstrează formatarea sigură: p, strong, em, liste, titluri, br", () => {
  const html =
    "<h2>Titlu</h2><p>Text <strong>bold</strong> și <em>italic</em><br>linie nouă</p><ul><li>unu</li><li>doi</li></ul>";
  assert.equal(sanitizeHtml(html), html);
});

test("elimină <script>/<style>/<iframe> cu tot cu conținut și comentariile", () => {
  const out = sanitizeHtml(
    '<p>ok</p><script>alert(1)</script><style>body{}</style><iframe src="x"></iframe><!-- secret -->'
  );
  assert.equal(out, "<p>ok</p>");
});

test("script neînchis / cu majuscule / spart în bucăți e tot eliminat", () => {
  assert.ok(!/script|alert/i.test(sanitizeHtml("<SCRIPT>alert(1)</SCRIPT>")));
  assert.ok(!/<script/i.test(sanitizeHtml("<scr<script>ipt>alert(1)</scr</script>ipt>")));
  assert.ok(!/<script/i.test(sanitizeHtml("<script>alert(1)")));
});

test("atributele periculoase dispar: onerror, onclick, style, class, id", () => {
  const out = sanitizeHtml(
    '<p onclick="x()" style="color:red" class="c" id="i">t</p><img src=x onerror=alert(1)>'
  );
  assert.equal(out, "<p>t</p>");
  assert.ok(!/on\w+=|style=|<img/i.test(out));
});

test("linkuri: http(s), mailto, tel, cale internă și ancoră sunt permise; rel adăugat", () => {
  for (const href of [
    "https://artfest.ro/x?a=1&b=2",
    "http://exemplu.ro",
    "mailto:a@b.ro",
    "tel:+40700000000",
    "/colectii/nunta",
    "#sus",
  ]) {
    const out = sanitizeHtml(`<a href="${href}">t</a>`);
    assert.match(out, /^<a href="/, href);
    assert.match(out, /rel="noopener noreferrer"/, href);
  }

  // & din href e escapat în atribut
  assert.match(
    sanitizeHtml('<a href="https://x.ro/?a=1&b=2">t</a>'),
    /href="https:\/\/x\.ro\/\?a=1&amp;b=2"/
  );
});

test("linkuri periculoase sunt neutralizate (fără href): javascript:, data:, vbscript:, //host, entități, spații/control", () => {
  const bad = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html;base64,AAAA",
    "vbscript:msgbox(1)",
    "//evil.example/x",
    "&#106;avascript:alert(1)",
    "http&#58;//x",
    "file:///etc/passwd",
    "",
  ];

  for (const href of bad) {
    const out = sanitizeHtml(`<a href="${href}">click</a>`);
    assert.equal(out, "<a>click</a>", JSON.stringify(href));
  }
});

test("href fără ghilimele / cu apostrof e tratat la fel", () => {
  assert.equal(sanitizeHtml("<a href=javascript:alert(1)>x</a>"), "<a>x</a>");
  assert.match(sanitizeHtml("<a href='/ok'>x</a>"), /^<a href="\/ok"/);
});

test("ghilimele injectate în href nu pot ieși din atribut", () => {
  const out = sanitizeHtml('<a href="https://x.ro/&quot; onmouseover=&quot;alert(1)">x</a>');
  assert.ok(!/ onmouseover=/i.test(out.replace(/&amp;quot;/g, "")));
  assert.ok(!/"\s*onmouseover/i.test(out));
});

test("`<` care nu e o etichetă validă și text cu simboluri sunt escapate", () => {
  assert.equal(sanitizeHtml("1 < 2 și 3 > 2"), "1 &lt; 2 și 3 &gt; 2");
  assert.equal(sanitizeHtml("<<b>x</b>"), "&lt;<b>x</b>");
  assert.equal(sanitizeHtml("Tom & Jerry &amp; co"), "Tom &amp; Jerry &amp; co");
});

test("etichete neacceptate dispar, textul rămâne (div, span, img, form, table)", () => {
  assert.equal(sanitizeHtml("<div><span>text</span></div>"), "text");
  assert.equal(sanitizeHtml('<img src="x">fără imagine'), "fără imagine");
  assert.ok(!/form|input/i.test(sanitizeHtml('<form action="/x"><input name="a">z</form>')));
});

test("etichetele sunt echilibrate: rămase deschise se închid, închiderile fără pereche se ignoră", () => {
  assert.equal(sanitizeHtml("<p><strong>x"), "<p><strong>x</strong></p>");
  assert.equal(sanitizeHtml("x</p></strong>"), "x");
  assert.equal(sanitizeHtml("<b><i>x</b>y"), "<b><i>x</i></b>y");
});

test("input gol / non-string", () => {
  assert.equal(sanitizeHtml(""), "");
  assert.equal(sanitizeHtml(null), "");
  assert.equal(sanitizeHtml(undefined), "");
  assert.equal(sanitizeHtml(42), "42");
});

test("niciun output nu conține marcaj în afara listei albe (fuzz pe vectori uzuali)", () => {
  const vectors = [
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '<body onload=alert(1)>',
    '<math><mi xlink:href="javascript:alert(1)">',
    '<a href="javascript:alert(1)" onclick="x">a</a>',
    '"><script>alert(1)</script>',
    "<scr\0ipt>alert(1)</scr\0ipt>",
    "<a href=\"x\" href=\"javascript:alert(1)\">a</a>",
    '<p style="background:url(javascript:alert(1))">x</p>',
    "<object data=x></object><embed src=x>",
    "<template><script>x</script></template>",
  ];

  const allowed = /<\/?(p|br|strong|b|em|i|u|ul|ol|li|a|h2|h3|h4|blockquote)(\s+href="[^"]*"\s+rel="noopener noreferrer")?>/g;

  for (const v of vectors) {
    const out = sanitizeHtml(v);
    const stripped = out.replace(allowed, "");
    assert.ok(!/</.test(stripped), `marcaj neașteptat pentru ${JSON.stringify(v)} -> ${out}`);
    assert.ok(!/javascript:/i.test(out), `javascript: în ${out}`);
    assert.ok(!/\son\w+=/i.test(out), `handler în ${out}`);
  }
});

/* ---------- htmlToText ---------- */

test("htmlToText: text simplu, entități decodate, spații colapsate", () => {
  assert.equal(
    htmlToText("<p>Salut&nbsp;lume</p><p>A &amp; B</p><script>x()</script>"),
    "Salut lume A & B"
  );
  assert.equal(htmlToText("  <b>a</b>\n\n<i>b</i>  "), "a b");
  assert.equal(htmlToText(null), "");
});
