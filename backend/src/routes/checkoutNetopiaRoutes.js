// backend/src/routes/checkoutNetopiaRoutes.js
import { Router } from "express";
import { prisma } from "../db.js";
import { sendOrderConfirmationEmail } from "../lib/mailer.js";

const router = Router();

const APP_ORIGIN =
  process.env.APP_ORIGIN ||
  process.env.FRONTEND_URL ||
  "http://localhost:5173";

const NETOPIA_ENDPOINT =
  process.env.NETOPIA_ENDPOINT || "https://sandboxsecure.mobilpay.ro";

// ================== UTIL: construiește request-ul către Netopia ==================
/**
 * ATENȚIE:
 * - Aici trebuie să folosești SDK-ul oficial Node.js sau exemplul de pe:
 *   https://github.com/mobilpay/Node.js :contentReference[oaicite:0]{index=0}
 * - În esență:
 *   - construiești obiectul `data` (order, signature, url.return, url.confirm, invoice, contact_info)
 *   - îl transformi în XML
 *   - criptare AES + RSA cu certificatul Netopia
 *   - întorci { envKey, encData }
 */
async function buildNetopiaPaymentRequest({ order, items }) {
  const signature = process.env.NETOPIA_SIGNATURE; // seller account signature
  if (!signature) {
    throw new Error("NETOPIA_SIGNATURE nu este setat în .env");
  }

  const amount = order.total;
  const currency = order.currency || "RON";

  const billing = order.shippingAddress || {};
  const orderId = order.id;
  const now = new Date();

  const returnUrl = `${APP_ORIGIN}/plata/netopia/return?orderId=${encodeURIComponent(
    orderId
  )}`;
  const confirmUrl = `${
    process.env.API_PUBLIC_URL || APP_ORIGIN.replace("5173", "5000")
  }/api/payments/netopia/confirm`;

  // 1) Construiește structura `data` conform documentației Netopia
  const data = {
    order: {
      $: {
        id: orderId,
        timestamp: now.getTime(),
        type: "card",
      },
      signature,
      url: {
        return: returnUrl,
        confirm: confirmUrl,
      },
      invoice: {
        $: {
          currency,
          amount,
        },
        details: `Plată comandă #${orderId}`,
        contact_info: {
          billing: {
            $: { type: "person" },
            first_name: billing.firstName || "",
            last_name: billing.lastName || "",
            address: `${billing.street || ""}, ${billing.city || ""}, ${
              billing.county || ""
            }`,
            email: billing.email || "",
            mobile_phone: billing.phone || "",
          },
        },
      },
      ipn_cipher: "aes-256-cbc",
    },
  };

  // 2) TODO: Transformă `data` în XML, criptează și semnează conform SDK-ului.
  //    De ex. în PoC-ul oficial există un fișier `encrypt.js` care face exact asta. :contentReference[oaicite:1]{index=1}
  //
  //    Aici ar trebui să ajungi la ceva de forma:
  //      const { envKey, encData } = encryptWithNetopia({ data, publicCertPath, privateKeyPath });
  //
  //    Până implementezi criptarea, întorc un dummy care va afișa o eroare în gateway:
  const envKey = "DUMMY_ENV_KEY";
  const encData = "DUMMY_ENCRYPTED_DATA";

  return { envKey, encData };
}

// ================== START: redirect către formularul de card ==================
router.get("/checkout/netopia/start", async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "").trim();
    if (!orderId) return res.status(400).send("orderId lipsă");

    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) return res.status(404).send("Comanda nu există");

    if (order.paymentMethod !== "CARD") {
      return res.status(400).send("Comanda nu este cu plată prin card");
    }

    const items = await prisma.shipmentItem.findMany({
      where: {
        shipment: {
          orderId,
        },
      },
    });

    const { envKey, encData } = await buildNetopiaPaymentRequest({
      order,
      items,
    });

    // HTML simplu cu un formular care se auto-trimite către Netopia
    const html = `
      <!doctype html>
      <html lang="ro">
        <head>
          <meta charset="utf-8" />
          <title>Redirectare către platii securizate</title>
        </head>
        <body>
          <p>Te redirecționăm către procesatorul de plăți...</p>
          <form id="netopia-form" action="${NETOPIA_ENDPOINT}" method="POST">
            <input type="hidden" name="env_key" value="${envKey}" />
            <input type="hidden" name="data" value="${encData}" />
            <noscript>
              <button type="submit">Continuă către plata securizată</button>
            </noscript>
          </form>
          <script>
            document.getElementById('netopia-form').submit();
          </script>
        </body>
      </html>
    `;

    res.status(200).send(html);
  } catch (err) {
    console.error("Eroare start Netopia:", err);
    res.status(500).send("Eroare la inițierea plății.");
  }
});

// ================== IPN: confirm-area plății ==================
/**
 * Netopia trimite aici un POST cu env_key + data.
 * Trebuie să:
 *  - decriptezi payload-ul
 *  - extragi orderId și status-ul tranzacției
 *  - marchezi comanda ca plătită/neplătită
 */
router.post("/payments/netopia/confirm", async (req, res) => {
  try {
    const { env_key, data } = req.body || {};
    if (!env_key || !data) {
      return res.status(400).send("Missing env_key/data");
    }

    // TODO: decriptează + parsează XML (folosind același mecanism ca în PoC/SDK)
    // const { orderId, status } = await decodeNetopiaIpn({ env_key, data })

    // Pentru exemplu, pun un mock:
    const orderId = "mock-order-id";
    const status = "confirmed"; // ex: confirmed, paid, cancelled, etc.

    if (!orderId) {
      return res.status(400).send("orderId lipsă");
    }

    if (status === "confirmed" || status === "paid") {
      const order = await prisma.order.update({
        where: { id: orderId },
        data: { status: "PAID" },
      });

      // trimitem email de confirmare abia acum
      try {
        const items = await prisma.shipmentItem.findMany({
          where: { shipment: { orderId } },
        });

        await sendOrderConfirmationEmail({
          to: order.shippingAddress?.email,
          order,
          items,
        });
      } catch (err) {
        console.error("Eroare email confirmare după plată:", err);
      }
    } else {
      // dacă eșuează plata, poți marca drept CANCELED / PAYMENT_FAILED
      await prisma.order.update({
        where: { id: orderId },
        data: { status: "PAYMENT_FAILED" },
      });
    }

    // Răspuns simplu pentru Netopia
    res.status(200).send("OK");
  } catch (err) {
    console.error("Eroare IPN Netopia:", err);
    res.status(500).send("ERROR");
  }
});

// ================== RETURN: redirect pentru user ==================
router.get("/payments/netopia/return", async (req, res) => {
  const orderId = String(req.query.orderId || "");
  // Poți eventual să verifici status-ul comenzii și să afișezi un mesaj
  const redirectUrl = `${APP_ORIGIN}/multumim?order=${encodeURIComponent(
    orderId
  )}`;
  return res.redirect(302, redirectUrl);
});

export default router;
