// src/routes/vendorInvoices.pdf.test.js
//
// GET /api/vendors/me/invoices/:id/pdf - factura de comision deja emisă în
// SmartBill, al cărei PDF local a dispărut (discul Render se golește la
// deploy): se servește PDF-ul OFICIAL recuperat din SmartBill după serie +
// număr, doar vânzătorului căruia îi aparține factura. Nu se emite nimic,
// nu se trimit emailuri. FĂRĂ DB real, FĂRĂ rețea (SmartBill simulat).
//
// Rulare: node --experimental-test-module-mocks --test src/routes/vendorInvoices.pdf.test.js

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_dummy";

import { test, mock, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";

const OFFICIAL_PDF = Buffer.from("%PDF-1.4 smartbill oficial AFC-0007\n%%EOF");

const vendorsByUser = { "user-a": { id: "vendor-a" }, "user-b": { id: "vendor-b" } };
const invoices = [
  {
    id: "inv-sb",
    vendorId: "vendor-a",
    direction: "PLATFORM_TO_VENDOR",
    type: "COMMISSION",
    provider: "SMARTBILL",
    series: "AFC",
    number: "0007",
    providerSeries: "AFC",
    providerNumber: "0007",
    pdfUrl: "/uploads/invoices/AFC-0007.pdf",
    providerPdfUrl: "/uploads/invoices/AFC-0007.pdf",
  },
  {
    id: "inv-local",
    vendorId: "vendor-a",
    direction: "PLATFORM_TO_VENDOR",
    type: "COMMISSION",
    provider: "LOCAL",
    series: "AF",
    number: "12",
    pdfUrl: null,
    providerPdfUrl: null,
  },
  {
    id: "inv-traversal",
    vendorId: "vendor-a",
    direction: "PLATFORM_TO_VENDOR",
    type: "COMMISSION",
    provider: "SMARTBILL",
    series: "AFC",
    number: "0008",
    providerSeries: "AFC",
    providerNumber: "0008",
    pdfUrl: "/uploads/../.env",
    providerPdfUrl: "/uploads/../.env",
  },
];

let smartBillCalls;
let smartBillFails;
let htmlPdfCalls;

const fakeDb = {
  vendor: {
    findUnique: async ({ where }) => vendorsByUser[where.userId] || null,
  },
  invoice: {
    findFirst: async ({ where }) =>
      invoices.find(
        (inv) => inv.id === where.id && inv.vendorId === where.vendorId && inv.direction === where.direction
      ) || null,
  },
};

let server;
let baseUrl;
let tmpDir;
let prevCwd;
let restoreAll;

before(async () => {
  // fișierele (lipsă / refăcute) stau într-un director temporar, nu în repo
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "artfest-invoice-pdf-"));
  await fs.writeFile(path.join(tmpDir, ".env"), "SECRET=nu-trebuie-servit");
  prevCwd = process.cwd();
  process.chdir(tmpDir);

  const mocks = [
    mock.module("../db.js", { namedExports: { prisma: fakeDb } }),
    mock.module("../api/auth.js", {
      namedExports: {
        authRequired: (req, res, next) => {
          const sub = req.headers["x-test-user"];
          if (!sub) return res.status(401).json({ error: "unauthenticated" });
          req.user = { sub };
          next();
        },
        enforceTokenVersion: (_req, _res, next) => next(),
      },
    }),
    mock.module("../lib/smartbill.js", {
      namedExports: {
        getSmartBillInvoicePdfBuffer: async (ref) => {
          smartBillCalls.push(ref);
          if (smartBillFails) throw new Error("SMARTBILL_PDF_FAILED");
          return OFFICIAL_PDF;
        },
        createSmartBillInvoice: async () => assert.fail("nu se emit facturi"),
      },
    }),
    mock.module("../lib/htmlToPdf.js", {
      namedExports: {
        htmlToPdfBuffer: async () => {
          htmlPdfCalls += 1;
          return Buffer.from("%PDF-1.4 local html\n%%EOF");
        },
      },
    }),
    mock.module("../lib/platformBilling.js", {
      namedExports: {
        getPlatformBillingOrThrow: async () => ({ email: "support@example.com" }),
      },
    }),
  ];
  restoreAll = () => mocks.forEach((m) => m.restore());

  const mod = await import(`./vendorInvoices.js?t=${Date.now()}`);
  const app = express();
  app.use("/api", mod.default);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restoreAll?.();
  process.chdir(prevCwd);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  smartBillCalls = [];
  smartBillFails = false;
  htmlPdfCalls = 0;
});

const getPdf = (id, user) =>
  fetch(`${baseUrl}/api/vendors/me/invoices/${id}/pdf`, { headers: user ? { "x-test-user": user } : {} });

test("PDF local lipsă + factură SmartBill -> PDF-ul OFICIAL din SmartBill, copia locală refăcută", async () => {
  const localPath = path.join(tmpDir, "uploads", "invoices", "AFC-0007.pdf");
  await fs.rm(localPath, { force: true });

  const res = await getPdf("inv-sb", "user-a");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition"), /AFC-0007\.pdf/);
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), OFFICIAL_PDF);
  assert.deepEqual(smartBillCalls, [{ seriesName: "AFC", number: "0007" }]);
  assert.equal(htmlPdfCalls, 0, "fără PDF generat din HTML / Chrome");

  // copia refăcută la aceeași cale -> următoarea descărcare nu mai cheamă SmartBill
  assert.deepEqual(await fs.readFile(localPath), OFFICIAL_PDF);
  const again = await getPdf("inv-sb", "user-a");
  assert.equal(again.status, 200);
  assert.deepEqual(Buffer.from(await again.arrayBuffer()), OFFICIAL_PDF);
  assert.equal(smartBillCalls.length, 1);
});

test("alt vânzător NU poate deschide factura (404, SmartBill neapelat)", async () => {
  const res = await getPdf("inv-sb", "user-b");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "invoice_not_found" });
  assert.equal(smartBillCalls.length, 0);
});

test("fără cont de vânzător -> 403; neautentificat -> 401", async () => {
  assert.equal((await getPdf("inv-sb", "user-fara-magazin")).status, 403);
  assert.equal((await getPdf("inv-sb", null)).status, 401);
  assert.equal(smartBillCalls.length, 0);
});

test("SmartBill indisponibil -> 502 clar, fără PDF neoficial generat din HTML", async () => {
  await fs.rm(path.join(tmpDir, "uploads", "invoices", "AFC-0007.pdf"), { force: true });
  smartBillFails = true;
  const res = await getPdf("inv-sb", "user-a");
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "smartbill_pdf_unavailable");
  assert.equal(htmlPdfCalls, 0);
});

test("factură LOCAL (fără SmartBill) -> comportamentul de dinainte: PDF generat din HTML", async () => {
  const res = await getPdf("inv-local", "user-a");
  assert.equal(res.status, 200);
  assert.equal(htmlPdfCalls, 1);
  assert.equal(smartBillCalls.length, 0);
});

test("căi în afara uploads/ nu sunt servite niciodată", async () => {
  const res = await getPdf("inv-traversal", "user-a");
  const body = Buffer.from(await res.arrayBuffer()).toString();
  assert.equal(res.status, 200);
  assert.doesNotMatch(body, /SECRET/);
  assert.deepEqual(smartBillCalls, [{ seriesName: "AFC", number: "0008" }]);
  // copia NU e scrisă peste .env
  assert.equal(await fs.readFile(path.join(tmpDir, ".env"), "utf8"), "SECRET=nu-trebuie-servit");
});
