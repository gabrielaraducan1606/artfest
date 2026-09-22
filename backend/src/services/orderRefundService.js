// src/services/orderRefundService.js
//
// Refund integral al unei comenzi plătite CU CARDUL (transfer reversal
// către vendori + refund client + reversal ledger financiar).
//
// Extras VERBATIM din POST /api/admin/orders/:id/refund (CAZ 1 - CARD,
// adminOrdersRoutes.js) ca să poată fi reutilizat și de anularea
// comenzii de către client (userOrdersRoutes.js -> cancelOwnOrder),
// fără a duplica logica financiară. Singurele diferențe față de
// varianta inline: (1) întoarce { status, body } în loc să scrie pe
// `res`, (2) actorul din nota de audit, metadata Stripe și prefixul
// cheii de idempotență sunt parametri (implicit: valorile admin
// existente, deci comportamentul rutei admin rămâne identic).
//
// Idempotent: reia doar ce n-a reușit (transferuri deja reversate /
// charge deja rambursat / ledger deja reversat sunt no-op).
// Erorile Stripe (ex. balance_insufficient) se propagă apelantului.

import { prisma as defaultPrisma } from "../db.js";
import { stripe as defaultStripe } from "../lib/stripe.js";
import {
  ensureRefundLedgerEntry,
  ensureInfluencerRefundLedgerEntry,
  ensureVendorReferralRefundLedgerEntry,
} from "../routes/vendorOrdersRoutes.js";

const normalizeText = (value = "") =>
  String(value || "").trim();

/*
 * `order` trebuie încărcat cu `shipments` (toate câmpurile scalare) -
 * exact ca în ruta admin.
 */
export async function refundCardOrderFully({
  order,
  actor = "admin",
  metaKind = "admin_order_refund",
  keyPrefix = "admin-order-refund",
  // Injectabile (implicit clientii reali) - ruta admin își pasează
  // propriile instanțe, ca testele existente (care re-importă ruta
  // cu mock-uri proaspete) să rămână valide.
  prisma = defaultPrisma,
  stripe = defaultStripe,
}) {
        const chargeId =
          order.stripeChargeId
            ? String(
                order.stripeChargeId
              )
            : null;

        if (!chargeId) {
          return {
            status: 409,
            body: {
              error:
                "card_charge_missing",

              message:
                "Comanda nu are o plată Stripe confirmată care să poată fi rambursată.",
            },
          };
        }

        /*
         * Găsim toate transferurile
         * făcute către vendorii comenzii.
         *
         * În webhook-ul plății integrale
         * salvăm stripeTransferId în
         * VendorEarningEntry.
         */
        const earningEntries =
          await prisma.vendorEarningEntry.findMany({
            where: {
              orderId:
                order.id,

              stripeTransferId: {
                not:
                  null,
              },
            },

            select: {
              id: true,
              vendorId: true,
              shipmentId:
                true,
              stripeTransferId:
                true,
            },
          });

        if (
          !earningEntries.length
        ) {
          return {
            status: 409,
            body: {
              error:
                "vendor_transfers_missing",

              message:
                "Nu am găsit transferurile Stripe către vendori. Rambursarea a fost oprită pentru verificare manuală.",
            },
          };
        }

        const reversals = [];

        /*
         * Un vendor cu mai multe shipment-uri OUTBOUND are mai multe
         * VendorEarningEntry (SALE per shipment) pe ACELAȘI transfer
         * Stripe. Transferul se reversează o singură dată; ledger-ul
         * (pasul 3) reversează apoi fiecare rând.
         */
        const processedTransferIds = new Set();

        /*
         * ==========================================
         * 1. RECUPERĂM TRANSFERURILE VENDORILOR
         * ==========================================
         */
        for (
          const entry of
          earningEntries
        ) {
          const transferId =
            entry
              .stripeTransferId
              ? String(
                  entry
                    .stripeTransferId
                )
              : null;

          if (!transferId) {
            continue;
          }

          if (processedTransferIds.has(transferId)) {
            continue;
          }

          processedTransferIds.add(transferId);

          /*
           * Citim transferul direct din Stripe,
           * ca să știm cât a fost deja reversat.
           */
          const transfer =
            await stripe.transfers.retrieve(
              transferId
            );

          const transferAmount =
            Number(
              transfer.amount ||
                0
            );

          const amountReversed =
            Number(
              transfer.amount_reversed ||
                0
            );

          const remainingToReverse =
            Math.max(
              0,

              transferAmount -
                amountReversed
            );

          /*
           * Dacă a fost deja reversat complet,
           * nu mai trimitem încă o operațiune.
           */
          if (
            remainingToReverse <=
            0
          ) {
            reversals.push({
              vendorId:
                entry.vendorId,

              transferId,

              alreadyReversed:
                true,

              amountCents:
                0,
            });

            continue;
          }

          const reversal =
            await stripe.transfers.createReversal(
              transferId,
              {
                amount:
                  remainingToReverse,

                metadata: {
                  kind:
                    metaKind,

                  orderId:
                    String(
                      order.id
                    ),

                  vendorId:
                    String(
                      entry.vendorId
                    ),
                },
              },
              {
                idempotencyKey:
                  `${keyPrefix}-reversal-${order.id}-${transferId}`,
              }
            );

          reversals.push({
            vendorId:
              entry.vendorId,

            transferId,

            reversalId:
              reversal.id,

            amountCents:
              Number(
                reversal.amount ||
                  remainingToReverse
              ),
          });
        }

        /*
         * ==========================================
         * 2. REFUND CLIENT
         * ==========================================
         *
         * Refundăm doar suma care NU a fost
         * deja rambursată.
         */
        const charge =
          await stripe.charges.retrieve(
            chargeId
          );

        const chargeAmount =
          Number(
            charge.amount ||
              0
          );

        const amountAlreadyRefunded =
          Number(
            charge.amount_refunded ||
              0
          );

        const remainingRefundAmount =
          Math.max(
            0,

            chargeAmount -
              amountAlreadyRefunded
          );

        /*
         * Dacă plata a fost deja rambursată (retry după un prim apel
         * reușit pe partea Stripe), NU mai facem încă un refund -
         * dar NU mai oprim aici execuția (audit 2026-09-14, secțiunea
         * 4/7 - retry după Stripe succes + DB reversal eșuat): dacă
         * ne-am oprit aici, blocul de reversal DB de mai jos nu mai
         * era NICIODATĂ reluat, chiar dacă eșuase la prima încercare.
         * Continuăm fără `refund` (rămâne null) direct spre reversal-ul
         * DB, care e idempotent și reia doar ce n-a reușit.
         */
        const alreadyRefundedByStripe =
          remainingRefundAmount <=
          0;

        const refund =
          alreadyRefundedByStripe
            ? null
            : await stripe.refunds.create(
                {
                  charge:
                    chargeId,

                  amount:
                    remainingRefundAmount,

                  metadata: {
                    kind:
                      metaKind,

                    orderId:
                      String(
                        order.id
                      ),

                    orderNumber:
                      String(
                        order.orderNumber ||
                          ""
                      ),
                  },
                },
                {
                  idempotencyKey:
                    `${keyPrefix}-${order.id}-${chargeId}`,
                }
              );

        /*
         * Adăugăm o urmă simplă în notele
         * Admin, fără să avem nevoie acum
         * de migrare Prisma. Doar dacă chiar s-a
         * făcut un refund Stripe la ACEST apel -
         * la retry (alreadyRefundedByStripe), nu
         * mai adăugăm o notă duplicată.
         */
        if (refund) {
          const who = actor;

          const refundNote =
            `[${new Date().toISOString()} | ${who}] ` +
            `Refund Stripe ${refund.id} — ` +
            `${(
              remainingRefundAmount /
              100
            ).toFixed(2)} ${String(
              order.currency ||
                "RON"
            ).toUpperCase()}`;

          const oldNotes =
            normalizeText(
              order.adminNotes
            );

          await prisma.order.update({
            where: {
              id:
                order.id,
            },

            data: {
              adminNotes:
                oldNotes
                  ? `${oldNotes}\n${refundNote}`
                  : refundNote,
            },
          });
        }

        /*
         * ==========================================
         * 3. REVERSAL LEDGER (audit 2026-09-14, bug CRITICAL)
         * ==========================================
         *
         * Banii au fost deja reversați real în Stripe (pasul 1-2 de
         * mai sus, confirmate) - DB-ul financiar rămânea, până acum,
         * ca și cum vânzarea încă ar exista: VendorEarningEntry
         * nereversat -> factura lunară de comision ar fi facturat
         * vendorului o vânzare deja anulată; VendorReferralEarningEntry/
         * InfluencerEarningEntry nereversate -> payout-ul ar fi plătit
         * efectiv un câștig pentru o comandă rambursată integral.
         *
         * Reutilizăm STRICT helper-ele canonice deja existente
         * (aceleași folosite de PATCH /orders/:id/status al vendorului
         * și de admin Pickups /refused, /returned) - niciun calcul
         * financiar nou. Toate 3 sunt idempotente (upsert / căutare
         * după meta.refShipmentId) - un al doilea apel pe același
         * shipment (buton apăsat de două ori, retry) nu creează un al
         * doilea reversal și nu modifică sumele a doua oară.
         *
         * Status: PĂSTRĂM regula deja existentă (RETURNED/REFUSED),
         * fără status nou. DELIVERED -> RETURNED (marfa a ajuns la
         * client, tranzacția e acum reversată - cel mai apropiat sens
         * existent de "returnat"); orice alt status -> REFUSED
         * (aceeași regulă folosită deja la anularea de către client,
         * userOrdersRoutes.js - comandă anulată înainte de finalizare).
         *
         * Per shipment, într-o tranzacție proprie: dacă reversal-ul
         * DB al UNUI shipment eșuează, nu blocăm reversal-ul
         * celorlalte shipment-uri din aceeași comandă (multi-vendor) -
         * dar NU ascundem eroarea: o logăm clar și o raportăm în
         * răspuns (`dbReversals`), ca adminul să știe exact ce
         * necesită verificare manuală. Recovery: re-apelarea acestei
         * rute (același refund Stripe, deja idempotent) reia DOAR
         * shipment-urile la care reversal-ul DB nu s-a finalizat -
         * cele deja reversate sunt no-op (idempotență).
         */
        const shipmentById =
          new Map(
            (order.shipments || []).map(
              (shipment) => [String(shipment.id), shipment]
            )
          );

        const dbReversals = [];

        for (const entry of earningEntries) {
          let entryShipmentId = entry.shipmentId
            ? String(entry.shipmentId)
            : null;

          /*
           * SALE-ul creat la plata CARD (webhook Stripe) are
           * stripeTransferId dar NU are shipmentId. Înainte, o astfel de
           * intrare era ignorată complet aici: nici statusul livrării, nici
           * ledger-ul (REFUND) nu se reversau -> comisionul rămânea
           * facturabil pe o comandă rambursată. O legăm de livrarea
           * aceluiași vendor din comandă (o livrare per vendor per
           * comandă). Dacă asocierea e ambiguă NU ghicim: raportăm
           * dbReversalNeedsAttention pentru recovery manual.
           */
          if (!entryShipmentId) {
            const candidates = (order.shipments || []).filter(
              (shipment) =>
                String(shipment.vendorId) === String(entry.vendorId) &&
                shipment.direction !== "RETURN"
            );

            if (candidates.length !== 1) {
              dbReversals.push({
                shipmentId: null,
                vendorId: String(entry.vendorId),
                ok: false,
                error: candidates.length
                  ? "ambiguous_shipment_for_transfer_entry"
                  : "no_shipment_for_transfer_entry",
              });

              continue;
            }

            entryShipmentId = String(candidates[0].id);
          }

          const entryVendorId = String(entry.vendorId);

          const currentShipment =
            shipmentById.get(entryShipmentId) ||
            (await prisma.shipment.findUnique({
              where: { id: entryShipmentId },
              select: { status: true },
            }));

          /*
           * Idempotență status (găsit prin testul determinist de
           * reversal dublu, audit 2026-09-14): dacă shipment-ul e DEJA
           * într-o stare finală de anulare (RETURNED/REFUSED) - de la
           * un apel anterior al ACESTEI rute - NU mai re-derivăm
           * statusul din starea CURENTĂ (care e deja RETURNED/REFUSED,
           * nu mai DELIVERED) - altfel un al doilea apel (retry după
           * eșec parțial pe alt shipment, sau buton apăsat de două
           * ori) ar "răsturna" greșit RETURNED -> REFUSED, deși nimic
           * real nu s-a schimbat. Păstrăm statusul deja stabilit.
           */
          const alreadyCancelled =
            currentShipment?.status === "RETURNED" ||
            currentShipment?.status === "REFUSED";

          const nextShipmentStatus =
            alreadyCancelled
              ? currentShipment.status
              : currentShipment?.status === "DELIVERED"
              ? "RETURNED"
              : "REFUSED";

          try {
            await prisma.$transaction(async (tx) => {
              if (!alreadyCancelled) {
                await tx.shipment.update({
                  where: { id: entryShipmentId },
                  data:
                    nextShipmentStatus === "RETURNED"
                      ? {
                          status: "RETURNED",
                          returnedAt: new Date(),
                          refusedAt: null,
                        }
                      : {
                          status: "REFUSED",
                          refusedAt: new Date(),
                          deliveredAt: null,
                          returnedAt: null,
                          cancelReason:
                            currentShipment?.cancelReason ||
                            "Rambursat de admin (card)",
                        },
                });
              }

              await ensureRefundLedgerEntry({
                vendorId: entryVendorId,
                shipmentId: entryShipmentId,
                db: tx,
                includePaymentTimeSale: true,
              });

              await ensureInfluencerRefundLedgerEntry({
                shipmentId: entryShipmentId,
                db: tx,
              });

              await ensureVendorReferralRefundLedgerEntry({
                shipmentId: entryShipmentId,
                db: tx,
              });
            });

            dbReversals.push({
              shipmentId: entryShipmentId,
              vendorId: entryVendorId,
              status: nextShipmentStatus,
              ok: true,
            });
          } catch (dbReversalError) {
            console.error(
              "[admin/orders refund] DB ledger reversal FAILED for shipment:",
              entryShipmentId,
              "order:",
              order.id,
              dbReversalError
            );

            dbReversals.push({
              shipmentId: entryShipmentId,
              vendorId: entryVendorId,
              ok: false,
              error:
                dbReversalError?.message ||
                "db_reversal_failed",
            });
          }
        }

        const dbReversalFailed = dbReversals.some(
          (r) => !r.ok
        );

        return {
          status: 200,
          body: {
          ok:
            true,

          type:
            "CARD_FULL_REFUND",

          refundId:
            refund?.id ??
            null,

          alreadyRefundedByStripe,

          refundedAmount:
            Number(
              (
                (
                  alreadyRefundedByStripe
                    ? chargeAmount
                    : remainingRefundAmount
                ) /
                100
              ).toFixed(2)
            ),

          currency:
            String(
              order.currency ||
                "RON"
            ).toUpperCase(),

          reversals,

          dbReversals,

          /*
           * Stripe (client + vendor) a reușit garantat până aici -
           * acest flag NU indică eșecul refund-ului, ci că reversal-ul
           * DB financiar pentru cel puțin un shipment necesită
           * verificare/recovery manuală (re-apelarea rutei e sigură,
           * idempotentă).
           */
          dbReversalNeedsAttention:
            dbReversalFailed,

          message:
            dbReversalFailed
              ? "ATENȚIE: reversal-ul ledger-ului financiar a eșuat pentru cel puțin un shipment - vezi dbReversals. Reapelează ruta pentru a relua doar partea eșuată (Stripe nu va fi atins din nou)."
              : alreadyRefundedByStripe
              ? "Plata era deja rambursată integral clientului anterior; transferurile către vendori și ledger-ul financiar (comision, referral, influencer) au fost reversate/confirmate acum."
              : "Plata a fost rambursată integral clientului, transferurile către vendori au fost reversate, iar ledger-ul financiar (comision, referral, influencer) a fost reversat corect.",
        },
        };
}
