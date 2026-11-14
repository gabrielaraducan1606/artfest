// backend/src/routes/secretSantaRoutes.js
//
// Secret Santa Artfest (separat de Târg). Montate în server.js:
//   /api/public/secret-santa   GET  /                      ediția curentă (fără date personale)
//   /api/vendor/secret-santa   GET  /                      starea mea (înscriere, destinatarul meu, coletul meu)
//                              POST /registration          înscriere / actualizare (cât sunt deschise înscrierile)
//                              POST /registration/withdraw retragere înainte de extragere
//                              POST /shipped               { awb?, courierName? } cadoul meu a plecat
//   /api/admin/secret-santa    GET  /editions | POST /editions | PATCH /editions/:id
//                              POST /editions/:id/status   { status: OPEN | CLOSED }
//                              GET  /editions/:id          participanți + atribuiri
//                              DELETE /editions/:id/participants/:participantId   (doar înainte de extragere)
//                              POST /editions/:id/draw     { confirm: <cheia ediției> }
//                              POST /editions/:id/resend-emails  doar emailurile netrimise / eșuate
//                              POST /editions/:id/purge    { confirm } șterge datele de livrare
//
// vendorId vine EXCLUSIV din sesiune; un expeditor vede doar destinatarul lui,
// iar un destinatar nu vede niciodată expeditorul.

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";
import { clientIpKey } from "../middleware/customizationUploadRateLimit.js";
import { sendSecretSantaAssignmentEmail } from "../lib/mailer.js";
import {
  SecretSantaError,
  createEdition,
  drawEdition,
  getAdminTestFormState,
  getEditionDetail,
  getPublicState,
  getVendorState,
  listEditions,
  markShipped,
  purgePersonalData,
  registerAdminTestForm,
  registerVendor,
  removeParticipant,
  sendAssignmentEmails,
  setEditionStatus,
  updateEdition,
  withdrawAdminTestForm,
  withdrawVendor,
} from "../services/secretSantaService.js";

const APP_URL = (process.env.APP_URL || process.env.FRONTEND_URL || "https://www.artfest.ro").replace(/\/+$/, "");

function handle(fn, tag) {
  return async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      await fn(req, res);
    } catch (error) {
      if (error instanceof SecretSantaError) {
        return res
          .status(error.status)
          .json({ error: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) });
      }
      // fără date personale în log: doar ruta și codul erorii
      console.error(`[secretSanta:${tag}]`, req.method, req.baseUrl + req.route?.path, error?.code || error?.name || "error");
      return res.status(500).json({ error: "server_error", message: "A apărut o eroare. Încearcă din nou." });
    }
  };
}

// ?edition=<cheie> - doar pentru edițiile de TEST (vezi config/secretSanta.js)
const editionKeyOf = (req) => (typeof req.query?.edition === "string" ? req.query.edition.slice(0, 60) : null);

function writeLimiter(limit) {
  return rateLimit({
    windowMs: 10 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `secret-santa:${req.user?.sub || clientIpKey(req.ip)}`,
    // clientIpKey apelează deja ipKeyGenerator (IPv6 grupat /56)
    validate: { keyGeneratorIpFallback: false },
    handler: (_req, res) =>
      res.status(429).json({ error: "rate_limited", message: "Prea multe încercări. Încearcă din nou peste câteva minute." }),
  });
}

export function createSecretSantaRouters({ db = prisma, sendEmail = sendSecretSantaAssignmentEmail, appUrl = APP_URL } = {}) {
  /* ---------- public ---------- */
  const publicRouter = Router();
  publicRouter.get(
    "/",
    handle(async (req, res) => res.json(await getPublicState({ db, editionKey: editionKeyOf(req) })), "public")
  );

  /* ---------- vânzător ---------- */
  const vendorRouter = Router();
  const vendorWrites = writeLimiter(Number(process.env.RATE_SECRET_SANTA_WRITE_MAX || 20));
  vendorRouter.use(authRequired);

  vendorRouter.get(
    "/",
    handle(async (req, res) => res.json(await getVendorState({ db, userId: req.user.sub, editionKey: editionKeyOf(req) })), "vendor")
  );
  vendorRouter.post(
    "/registration",
    vendorWrites,
    handle(async (req, res) => {
      const result = await registerVendor({ db, userId: req.user.sub, body: req.body || {}, editionKey: editionKeyOf(req) });
      res.status(result.updated ? 200 : 201).json({ ok: true, ...result });
    }, "register")
  );
  vendorRouter.post(
    "/registration/withdraw",
    vendorWrites,
    handle(async (req, res) => res.json(await withdrawVendor({ db, userId: req.user.sub, editionKey: editionKeyOf(req) })), "withdraw")
  );
  vendorRouter.post(
    "/shipped",
    vendorWrites,
    handle(async (req, res) => res.json(await markShipped({ db, userId: req.user.sub, body: req.body || {}, editionKey: editionKeyOf(req) })), "shipped")
  );

  /* ---------- Admin ---------- */
  const adminRouter = Router();
  adminRouter.use(authRequired, async (req, res, next) => {
    try {
      const user = await db.user.findUnique({ where: { id: req.user.sub }, select: { id: true, role: true } });
      if (!user) return res.status(401).json({ error: "unauthorized" });
      if (user.role !== "ADMIN") return res.status(403).json({ error: "forbidden" });
      req.adminUser = user;
      return next();
    } catch {
      return res.status(500).json({ error: "auth_check_failed" });
    }
  });

  const runEmails = (editionId) =>
    sendAssignmentEmails({ db, editionId, sendEmail, appUrl }).catch((error) =>
      console.error("[secretSanta] trimitere emailuri:", editionId, error?.code || error?.name || "error")
    );

  adminRouter.get("/editions", handle(async (_req, res) => res.json({ editions: await listEditions({ db }) }), "editions"));
  adminRouter.post(
    "/editions",
    handle(async (req, res) => res.status(201).json({ edition: await createEdition({ db, body: req.body || {} }) }), "create")
  );
  adminRouter.patch(
    "/editions/:id",
    handle(
      async (req, res) => res.json({ edition: await updateEdition({ db, editionId: req.params.id, body: req.body || {} }) }),
      "update"
    )
  );
  adminRouter.post(
    "/editions/:id/status",
    handle(
      async (req, res) =>
        res.json({ edition: await setEditionStatus({ db, editionId: req.params.id, status: String(req.body?.status || "") }) }),
      "status"
    )
  );
  adminRouter.get(
    "/editions/:id",
    handle(async (req, res) => res.json(await getEditionDetail({ db, editionId: req.params.id })), "detail")
  );
  adminRouter.delete(
    "/editions/:id/participants/:participantId",
    handle(
      async (req, res) =>
        res.json(await removeParticipant({ db, editionId: req.params.id, participantId: req.params.participantId })),
      "remove"
    )
  );
  adminRouter.post(
    "/editions/:id/draw",
    handle(async (req, res) => {
      const result = await drawEdition({
        db,
        editionId: req.params.id,
        adminUserId: req.adminUser.id,
        confirm: req.body?.confirm,
      });
      // emailurile pleacă după commit, în fundal; Adminul vede starea în listă
      runEmails(req.params.id);
      res.json({ ...result, emails: "sending" });
    }, "draw")
  );
  adminRouter.post(
    "/editions/:id/resend-emails",
    handle(async (req, res) => {
      runEmails(req.params.id);
      res.json({ ok: true, emails: "sending" });
    }, "resend")
  );
  adminRouter.post(
    "/editions/:id/purge",
    handle(
      async (req, res) => res.json(await purgePersonalData({ db, editionId: req.params.id, confirm: req.body?.confirm })),
      "purge"
    )
  );

  // Formular de PROBĂ pe /secret-santa (doar ADMIN, doar până la 17.11.2026), în ediția TEST, fără emailuri
  adminRouter.get(
    "/test-form",
    handle(async (req, res) => res.json(await getAdminTestFormState({ db, adminUserId: req.adminUser.id })), "testFormGet")
  );
  adminRouter.post(
    "/test-form",
    handle(
      async (req, res) => res.json(await registerAdminTestForm({ db, adminUserId: req.adminUser.id, body: req.body || {} })),
      "testFormPost"
    )
  );
  adminRouter.post(
    "/test-form/withdraw",
    handle(async (_req, res) => res.json(await withdrawAdminTestForm({ db })), "testFormWithdraw")
  );

  return { publicRouter, vendorRouter, adminRouter };
}

const routers = createSecretSantaRouters();
export const secretSantaPublicRoutes = routers.publicRouter;
export const secretSantaVendorRoutes = routers.vendorRouter;
export const secretSantaAdminRoutes = routers.adminRouter;
