import { Router } from "express";
import { prisma } from "../db.js";

const router = Router();

function requireAdminMonitorToken(req, res, next) {
  const expected = process.env.ADMIN_MONITOR_TOKEN;
  if (!expected || !String(expected).trim()) {
    return res.status(500).json({ error: "ADMIN_MONITOR_TOKEN_NOT_CONFIGURED" });
  }

  const auth = req.headers.authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  const bearer = m?.[1];

  const legacy = req.headers["x-admin-token"];
  const token = bearer || legacy;

  if (!token || token !== expected) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
  next();
}

router.use(requireAdminMonitorToken);

/**
 * GET /api/admin/monitor/incidents
 * Query:
 *  - ack: "0" | "1" | ""
 *  - status: 500, 404...
 *  - limit: 25..200
 *  - archived: "0" | "1"
 *  - deleted: "0" | "1"
 *  - cursor: (id)
 *  - includeNotes: "1"
 */
router.get("/incidents", async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "50", 10)));
    const status = parseInt(req.query.status || "", 10);
    const ack = String(req.query.ack ?? "").trim();

    const archived = String(req.query.archived ?? "0") === "1";
    const deleted = String(req.query.deleted ?? "0") === "1";

    const cursor = String(req.query.cursor || "").trim() || null;
    const includeNotes = String(req.query.includeNotes || "") === "1";

    const where = {};

    // view logic:
    // active => deletedAt null AND archivedAt null
    // archived => deletedAt null AND archivedAt not null
    // deleted => deletedAt not null
    if (deleted) {
      where.deletedAt = { not: null };
    } else {
      where.deletedAt = null;
      if (archived) where.archivedAt = { not: null };
      else where.archivedAt = null;
    }

    if (!Number.isNaN(status)) where.statusCode = status;
    if (ack === "0") where.acknowledgedAt = null;
    if (ack === "1") where.acknowledgedAt = { not: null };

    const findArgs = {
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(includeNotes
        ? {
            include: {
              notes: { orderBy: { createdAt: "desc" } },
            },
          }
        : {}),
    };

    if (cursor) {
      // cursor pagination (descending)
      findArgs.cursor = { id: cursor };
      findArgs.skip = 1;
    }

    const rows = await prisma.routeIncident.findMany(findArgs);

    let nextCursor = null;
    let items = rows;

    if (rows.length > limit) {
      items = rows.slice(0, limit);
      nextCursor = items[items.length - 1]?.id || null;
    }

    res.json({ items, nextCursor });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/monitor/incidents/:id/ack */
router.post("/incidents/:id/ack", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const by = (req.body?.by || "admin").toString().slice(0, 120);

    const item = await prisma.routeIncident.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedBy: by },
    });

    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/monitor/incidents/:id/archive */
router.post("/incidents/:id/archive", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const by = (req.body?.by || "admin").toString().slice(0, 120);

    const item = await prisma.routeIncident.update({
      where: { id },
      data: { archivedAt: new Date(), archivedBy: by },
    });

    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/monitor/incidents/:id/unarchive */
router.post("/incidents/:id/unarchive", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const item = await prisma.routeIncident.update({
      where: { id },
      data: { archivedAt: null, archivedBy: null },
    });

    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/monitor/incidents/:id/delete (soft delete) */
router.post("/incidents/:id/delete", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const by = (req.body?.by || "admin").toString().slice(0, 120);

    const item = await prisma.routeIncident.update({
      where: { id },
      data: { deletedAt: new Date(), deletedBy: by },
    });

    res.json({ ok: true, item });
  } catch (e) {
    next(e);
  }
});

/** POST /api/admin/monitor/incidents/:id/notes  body: { by, note } */
router.post("/incidents/:id/notes", async (req, res, next) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "invalid_id" });

    const by = (req.body?.by || "admin").toString().slice(0, 120);
    const note = (req.body?.note || "").toString().trim();

    if (!note) return res.status(400).json({ error: "note_required" });

    const created = await prisma.routeIncidentNote.create({
      data: {
        incidentId: id,
        by,
        note: note.slice(0, 4000),
      },
    });

    res.json({ ok: true, item: created });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/admin/monitor/incidents/cleanup
 * body: { days: 30 }
 *
 * ✅ Șterge definitiv DOAR:
 * - deletedAt != null
 * - archivedAt == null  (arhivatele NU se șterg)
 * - mai vechi de X zile
 */
router.post("/incidents/cleanup", async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(3650, parseInt(req.body?.days || "30", 10)));
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await prisma.routeIncident.deleteMany({
      where: {
        deletedAt: { not: null },
        archivedAt: null,
        createdAt: { lt: cutoff },
      },
    });

    res.json({ ok: true, deletedCount: result.count, days });
  } catch (e) {
    next(e);
  }
});

export default router;
