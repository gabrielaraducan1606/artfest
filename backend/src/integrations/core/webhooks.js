// backend/src/integrations/core/webhooks.js
//
// Primirea webhook-urilor magazinelor externe (comună platformelor):
//   1. semnătura se verifică criptografic cu secretul conexiunii (criptat în
//      DB) - fără semnătură validă nu se înregistrează nimic;
//   2. livrarea se înregistrează o singură dată (connectionId + deliveryKey
//      unic): reluările aceleiași livrări sunt confirmate fără efect;
//   3. procesarea e asincronă (job PROCESS_WEBHOOK), iar webhook-ul e doar
//      un semnal - stocul se recitește din magazin (syncHandlers).
// Ruta HTTP (corp brut, înainte de express.json) nu e încă montată.

import crypto from "node:crypto";

import { getPlatform } from "./adapterRegistry.js";
import { openWebhookSecret } from "./connectionStore.js";
import { IntegrationError } from "./errors.js";
import { enqueueJob } from "./syncQueue.js";

/**
 * @returns {{ status: "ping" | "accepted" | "duplicate" }}
 */
export async function ingestWebhook({ db, connectionId, rawBody, headers }) {
  const connection = await db.externalStoreConnection.findUnique({ where: { id: connectionId } });
  if (!connection || connection.status === "DISCONNECTED") {
    throw new IntegrationError("webhook_unknown_connection", "Conexiune necunoscută.", { status: 404 });
  }
  const platform = getPlatform(connection.platform);
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");

  const parsed = platform.parseWebhook({ rawBody: body, headers });
  if (parsed.kind === "ping") return { status: "ping" };

  const secret = openWebhookSecret(connection);
  if (!platform.verifyWebhook({ rawBody: body, headers, secret })) {
    throw new IntegrationError("webhook_signature_invalid", "Semnătura webhook-ului nu este validă.", { status: 401 });
  }

  const created = await db.externalWebhookEvent.createMany({
    data: [
      {
        connectionId,
        deliveryKey: parsed.deliveryKey.slice(0, 191),
        topic: parsed.topic.slice(0, 100),
        resourceId: parsed.resourceId ? parsed.resourceId.slice(0, 64) : null,
        payloadHash: crypto.createHash("sha256").update(body).digest("hex"),
        // doar câmpurile necesare procesării (fără tot produsul)
        payload: { id: parsed.payload?.id ?? null, parent_id: parsed.payload?.parent_id ?? null, type: parsed.payload?.type ?? null },
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 0) return { status: "duplicate" };

  const event = await db.externalWebhookEvent.findUnique({
    where: { connectionId_deliveryKey: { connectionId, deliveryKey: parsed.deliveryKey.slice(0, 191) } },
    select: { id: true },
  });
  await enqueueJob(db, {
    connectionId,
    type: "PROCESS_WEBHOOK",
    payload: { eventId: event.id },
    dedupeKey: `webhook:${event.id}`,
    priority: 5,
  });
  return { status: "accepted" };
}
