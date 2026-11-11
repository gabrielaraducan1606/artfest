// backend/src/integrations/core/syncHandlers.js
//
// Handler-ele joburilor din coadă (syncQueue.runWorkerOnce), comune
// tuturor platformelor - vorbesc cu magazinul doar prin adaptor.
//
//   PULL_STOCK       citește stocul ACTUAL al unui produs din magazin și îl
//                    aplică (webhook-urile sunt doar semnale: nu aplicăm
//                    date din corpul lor, care pot sosi întârziat / în altă
//                    ordine);
//   PUSH_STOCK       trimite în magazin vânzările Artfest netrimise;
//   PROCESS_WEBHOOK  transformă un webhook înregistrat în PULL_STOCK sau
//                    marchează produsul șters din magazin;
//   RECONCILE        verificare periodică a tuturor produselor legate +
//                    trimiterea vânzărilor rămase netrimise.

import { adapterForConnection } from "./adapterRegistry.js";
import { applyExternalStock, LINK_INCLUDE, pushStock } from "./stockSync.js";
import { enqueueJob } from "./syncQueue.js";

const RECONCILE_BATCH = 50;

async function pullProductStock({ db, adapter, productLinkId, sourceKey }) {
  const links = await db.externalVariantLink.findMany({ where: { productLinkId }, include: LINK_INCLUDE });
  const results = [];
  for (const link of links) {
    if (link.stockManagedAt === "PARENT") continue; // stocul vine prin legătura părintelui
    const external = await adapter.getStock({
      externalProductId: link.productLink.externalProductId,
      externalVariantId: link.externalVariantId || null,
    });
    results.push({ linkId: link.id, ...(await applyExternalStock({ db, link, external, sourceKey })) });
  }
  return results;
}

/**
 * @param {{ adapterFor?: (connection) => Object }} [options]  adaptor injectat în teste
 */
export function createSyncHandlers({ adapterFor = (connection) => adapterForConnection(connection) } = {}) {
  const connectionOf = (db, job) => db.externalStoreConnection.findUnique({ where: { id: job.connectionId } });

  return {
    async PULL_STOCK({ db, job }) {
      const adapter = adapterFor(await connectionOf(db, job));
      const results = await pullProductStock({ db, adapter, productLinkId: job.payload.productLinkId, sourceKey: job.payload.sourceKey || `job:${job.id}` });
      return { units: results.length, applied: results.filter((r) => r.applied).length };
    },

    async PUSH_STOCK({ db, job }) {
      const adapter = adapterFor(await connectionOf(db, job));
      return pushStock({ db, adapter, variantLinkId: job.payload.variantLinkId });
    },

    async PROCESS_WEBHOOK({ db, job }) {
      const event = await db.externalWebhookEvent.findUnique({ where: { id: job.payload.eventId } });
      if (!event || event.status !== "RECEIVED") return { skipped: true };

      // variație -> produsul părinte; produs -> el însuși
      const externalProductId = event.payload?.parent_id ? String(event.payload.parent_id) : event.resourceId;
      const productLink = externalProductId
        ? await db.externalProductLink.findUnique({
            where: { connectionId_externalProductId: { connectionId: event.connectionId, externalProductId } },
          })
        : null;

      let outcome = "not_linked";
      if (productLink && /\.deleted$/.test(event.topic)) {
        // produsul Artfest NU se șterge: legătura se oprește, vânzătorul decide
        await db.externalProductLink.update({ where: { id: productLink.id }, data: { status: "EXTERNAL_DELETED" } });
        outcome = "external_deleted";
      } else if (productLink && productLink.status === "ACTIVE") {
        await enqueueJob(db, {
          connectionId: event.connectionId,
          type: "PULL_STOCK",
          payload: { productLinkId: productLink.id, sourceKey: `webhook:${event.deliveryKey}` },
          dedupeKey: `pull:${productLink.id}`,
          priority: 5,
        });
        outcome = "pull_queued";
      }

      await db.externalWebhookEvent.update({
        where: { id: event.id },
        data: { status: outcome === "not_linked" ? "IGNORED" : "PROCESSED", processedAt: new Date() },
      });
      return { outcome };
    },

    async RECONCILE({ db, job }) {
      const connection = await connectionOf(db, job);
      const adapter = adapterFor(connection);
      const sourceKey = `reconcile:${job.id}`;
      let cursor;
      let units = 0;
      let applied = 0;

      for (;;) {
        const batch = await db.externalProductLink.findMany({
          where: { connectionId: connection.id, status: "ACTIVE" },
          orderBy: { id: "asc" },
          take: RECONCILE_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          select: { id: true },
        });
        if (!batch.length) break;
        for (const { id } of batch) {
          const results = await pullProductStock({ db, adapter, productLinkId: id, sourceKey });
          units += results.length;
          applied += results.filter((r) => r.applied).length;
        }
        cursor = batch[batch.length - 1].id;
      }

      // vânzări Artfest rămase netrimise (ex. job pierdut) -> din nou în coadă
      const pending = await db.externalVariantLink.findMany({
        where: { pendingOutboundDelta: { not: 0 }, productLink: { connectionId: connection.id, status: "ACTIVE" } },
        select: { id: true },
      });
      for (const { id } of pending) {
        await enqueueJob(db, { connectionId: connection.id, type: "PUSH_STOCK", payload: { variantLinkId: id }, dedupeKey: `push:${id}`, priority: 10 });
      }

      return { units, applied, pushQueued: pending.length };
    },
  };
}
