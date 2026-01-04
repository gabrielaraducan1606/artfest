// backend/src/routes/unsubscribe.js
import express from "express";
import { prisma } from "../db.js";
import { verifyUnsubToken } from "../lib/unsubscribe.js";

const router = express.Router();

async function applyUnsubscribe({ email, category }) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("Missing email");

  if (category === "waitlist_digital") {
    await prisma.digitalWaitlistSubscriber
      .update({ where: { email: e }, data: { status: "unsubscribed" } })
      .catch(async () => {
        await prisma.digitalWaitlistSubscriber.create({
          data: { email: e, status: "unsubscribed", source: "unsubscribe_link" },
        });
      });
    return;
  }

  if (category === "marketing") {
    const user = await prisma.user.findUnique({ where: { email: e }, select: { id: true } });
    if (!user) return;

    await prisma.userMarketingPrefs.upsert({
      where: { userId: user.id },
      create: { userId: user.id, emailEnabled: false, marketingOptIn: false },
      update: { emailEnabled: false, marketingOptIn: false },
    });

    // dacă ai și câmp direct pe user (ai deja)
    await prisma.user.update({ where: { id: user.id }, data: { marketingOptIn: false } }).catch(() => {});
    return;
  }

  throw new Error("Unknown category");
}

function renderHtml({ ok, message }) {
  const title = ok ? "Dezabonare reușită" : "Link invalid";
  const color = ok ? "#16a34a" : "#dc2626";
  return `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#f9fafb;margin:0;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;">
    <h1 style="margin:0 0 10px;color:${color};font-size:20px;">${title}</h1>
    <p style="margin:0;color:#374151;line-height:1.5;">${message}</p>
  </div>
</body>
</html>`;
}

// Click (browser) unsubscribe
router.get("/unsubscribe", async (req, res) => {
  try {
    const token = req.query.token;
    const { email, category } = verifyUnsubToken(token);
    await applyUnsubscribe({ email, category });

    return res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .send(renderHtml({ ok: true, message: "Te-ai dezabonat cu succes. Mulțumim!" }));
  } catch {
    return res
      .status(400)
      .set("Content-Type", "text/html; charset=utf-8")
      .send(renderHtml({ ok: false, message: "Link invalid sau expirat." }));
  }
});

// One-click unsubscribe (Gmail etc.)
router.post("/unsubscribe", express.urlencoded({ extended: false }), async (req, res) => {
  try {
    // Gmail trimite POST la URL-ul din List-Unsubscribe; uneori tokenul e în query.
    // Uneori e în body (depinde de client), suportăm ambele.
    const token = req.query.token || req.body?.token;

    const { email, category } = verifyUnsubToken(token);
    await applyUnsubscribe({ email, category });

    // 200 OK este suficient
    return res.status(200).send("OK");
  } catch {
    return res.status(400).send("Bad Request");
  }
});

export default router;
