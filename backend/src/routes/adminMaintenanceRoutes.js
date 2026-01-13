import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired, requireRole } from "../api/auth.js";
import {
  sendInactiveAccountWarningEmail,
  sendPasswordStaleReminderEmail,
  sendSuspiciousLoginWarningEmail,
} from "../lib/mailer.js";

const router = Router();

// toate rutele sunt doar pentru ADMIN
router.use(authRequired, requireRole("ADMIN"));

// =========================
// CONFIG INACTIVITATE
// =========================

// configurabil prin .env (cu minime sănătoase)
const INACTIVITY_MONTHS = Math.max(
  1,
  Number(process.env.INACTIVITY_MONTHS || 12) // default 12 luni
);
const WARNING_DAYS_BEFORE = Math.max(
  7,
  Number(process.env.INACTIVITY_WARNING_DAYS || 30) // default 30 zile
);

// =========================
// CONFIG SECURITATE PAROLE / LOGIN
// =========================

const MAX_PASSWORD_AGE_DAYS = Math.max(
  1,
  Number(process.env.SEC_MAX_PASSWORD_AGE_DAYS || 180)
);

const MAX_FAILED_ATTEMPTS_24H = Math.max(
  1,
  Number(process.env.SEC_MAX_FAILED_ATTEMPTS_24H || 10)
);

function monthsBetween(date) {
  if (!date) return null;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;

  const now = new Date();
  let months =
    (now.getFullYear() - d.getFullYear()) * 12 +
    (now.getMonth() - d.getMonth());

  if (months < 0) months = 0;
  return months;
}

function daysBetween(a, b) {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * Helper: candidați la ștergere
 * - nu sunt ADMIN
 * - fără comenzi
 * - inactivi de >= INACTIVITY_MONTHS (lastLoginAt sau createdAt)
 */
async function findInactiveCandidates() {
  const users = await prisma.user.findMany({
    where: {
      role: { not: "ADMIN" },
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
      lastLoginAt: true,
      inactiveNotifiedAt: true,
      scheduledDeletionAt: true,
    },
  });

  const orderUsers = await prisma.order.findMany({
    select: { userId: true },
    distinct: ["userId"],
  });
  const userIdsWithOrders = new Set(orderUsers.map((o) => o.userId));

  const out = [];

  for (const u of users) {
    const lastActivity = u.lastLoginAt || u.createdAt;
    const m = monthsBetween(lastActivity);
    if (m == null) continue;
    if (m < INACTIVITY_MONTHS) continue;

    const hasOrders = userIdsWithOrders.has(u.id);
    if (hasOrders) continue;

    out.push({
      id: u.id,
      email: u.email,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      inactiveNotifiedAt: u.inactiveNotifiedAt,
      scheduledDeletionAt: u.scheduledDeletionAt,
      monthsInactive: m,
      hasOrders,
    });
  }

  return out;
}

/**
 * GET /api/admin/maintenance/inactive-preview
 * -> listă conturi inactive eligibile pentru ștergere
 */
router.get("/inactive-preview", async (_req, res) => {
  try {
    const items = await findInactiveCandidates();
    res.json({
      config: {
        inactivityMonths: INACTIVITY_MONTHS,
        warningDays: WARNING_DAYS_BEFORE,
      },
      total: items.length,
      items,
    });
  } catch (e) {
    console.error("ADMIN maintenance /inactive-preview error", e);
    res
      .status(500)
      .json({ error: "maintenance_inactive_preview_failed" });
  }
});

/**
 * GET /api/admin/maintenance/warnings-log
 * -> istoric emailuri de avertizare
 */
router.get("/warnings-log", async (_req, res) => {
  try {
    const logs = await prisma.inactiveWarningLog.findMany({
      orderBy: { sentAt: "desc" },
      take: 200,
    });

    res.json({ logs });
  } catch (e) {
    console.error("ADMIN maintenance /warnings-log error", e);
    res
      .status(500)
      .json({ error: "maintenance_warnings_log_failed" });
  }
});

/**
 * GET /api/admin/maintenance/cleanup-log
 * -> istoric ștergeri conturi inactive
 */
router.get("/cleanup-log", async (_req, res) => {
  try {
    const logs = await prisma.inactiveUserLog.findMany({
      orderBy: { deletedAt: "desc" },
      take: 200,
    });

    res.json({ logs });
  } catch (e) {
    console.error("ADMIN maintenance /cleanup-log error", e);
    res
      .status(500)
      .json({ error: "maintenance_cleanup_log_failed" });
  }
});

/**
 * POST /api/admin/maintenance/send-warnings
 * -> trimite mail de avertizare + setează scheduledDeletionAt + log în InactiveWarningLog
 */
router.post("/send-warnings", async (_req, res) => {
  try {
    const now = new Date();
    const deleteAt = new Date(
      now.getTime() + WARNING_DAYS_BEFORE * 24 * 60 * 60 * 1000
    );

    const candidates = await findInactiveCandidates();
    const toNotify = candidates.filter(
      (u) => !u.inactiveNotifiedAt && u.email
    );

    if (!toNotify.length) {
      return res.json({
        ok: true,
        totalCandidates: candidates.length,
        notified: 0,
        message: "Nu există conturi noi pentru avertizat.",
      });
    }

    let notified = 0;

    for (const u of toNotify) {
      let status = "OK";
      let errorMessage = null;

      try {
        await sendInactiveAccountWarningEmail({
          to: u.email,
          deleteAt,
        });

        await prisma.user.update({
          where: { id: u.id },
          data: {
            inactiveNotifiedAt: now,
            scheduledDeletionAt: deleteAt,
          },
        });

        notified += 1;
      } catch (err) {
        console.error(
          "Failed inactive warning for user",
          u.id,
          err
        );
        status = "ERROR";
        errorMessage = err?.message || String(err);
      }

      // logăm și încercările cu eroare
      try {
        await prisma.inactiveWarningLog.create({
          data: {
            userId: u.id,
            email: u.email,
            status,
            errorMessage,
          },
        });
      } catch (logErr) {
        console.error(
          "Failed to log inactive warning",
          logErr
        );
      }
    }

    res.json({
      ok: true,
      totalCandidates: candidates.length,
      notified,
    });
  } catch (e) {
    console.error("ADMIN maintenance /send-warnings error", e);
    res
      .status(500)
      .json({ error: "maintenance_send_warnings_failed" });
  }
});

/**
 * POST /api/admin/maintenance/run-cleanup
 * -> șterge conturile unde scheduledDeletionAt a trecut + log în InactiveUserLog
 */
router.post("/run-cleanup", async (_req, res) => {
  try {
    const now = new Date();

    const usersToDelete = await prisma.user.findMany({
      where: {
        role: { not: "ADMIN" },
        scheduledDeletionAt: {
          not: null,
          lte: now,
        },
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        lastLoginAt: true,
        scheduledDeletionAt: true,
        status: true,
        role: true,
      },
    });

    let deleted = 0;

    for (const u of usersToDelete) {
      try {
        const ordersCount = await prisma.order.count({
          where: { userId: u.id },
        });

        const lastActivity = u.lastLoginAt || u.createdAt;
        const monthsInactive = monthsBetween(lastActivity);

        await prisma.$transaction([
          prisma.inactiveUserLog.create({
            data: {
              userId: u.id,
              email: u.email,
              hadOrders: ordersCount > 0,
              monthsInactive: monthsInactive ?? null,
              lastLoginAt: u.lastLoginAt,
              createdAt: u.createdAt,
              scheduledDeletionAt: u.scheduledDeletionAt,
              reason: "INACTIVE_CLEANUP",
              meta: {
                status: u.status,
                role: u.role,
              },
            },
          }),
          prisma.user.delete({
            where: { id: u.id },
          }),
        ]);

        deleted += 1;
      } catch (err) {
        console.error(
          "Failed to delete inactive user",
          u.id,
          err
        );
      }
    }

    res.json({ ok: true, deleted });
  } catch (e) {
    console.error("ADMIN maintenance /run-cleanup error", e);
    res
      .status(500)
      .json({ error: "maintenance_run_cleanup_failed" });
  }
});

/**
 * GET /api/admin/maintenance/security-overview
 * -> overview parole vechi + conturi cu multe eșecuri recente
 */
router.get("/security-overview", async (_req, res) => {
  try {
    const now = new Date();

    // ================================
    // 1) STATISTICI PAROLE
    // ================================
    const users = await prisma.user.findMany({
      where: {
        role: { not: "ADMIN" },
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        lastPasswordChangeAt: true,
        locked: true,
      },
    });

    let stalePasswords = 0;
    let neverChanged = 0;
    let totalAgeDays = 0;
    let countWithAge = 0;

    for (const u of users) {
      const lastChange = u.lastPasswordChangeAt || u.createdAt;
      if (!lastChange) continue;

      const ageDays = daysBetween(new Date(lastChange), now);
      totalAgeDays += ageDays;
      countWithAge += 1;

      if (!u.lastPasswordChangeAt) {
        // niciodată schimbată explicit (doar parola de la signup)
        neverChanged += 1;
      }

      if (ageDays > MAX_PASSWORD_AGE_DAYS) {
        stalePasswords += 1;
      }
    }

    const avgPasswordAgeDays =
      countWithAge > 0
        ? Math.round(totalAgeDays / countWithAge)
        : null;

    const passwordStats = {
      stalePasswords,
      neverChanged,
      avgPasswordAgeDays,
    };

    // ================================
    // 2) CONTURI CU MULTE EȘECURI ÎN 24H
    // ================================
    const since24h = new Date(
      now.getTime() - 24 * 60 * 60 * 1000
    );

    let riskyLogins = [];

    try {
      const failedAttempts = await prisma.loginAttempt.groupBy({
        by: ["userId"],
        where: {
          success: false,
          createdAt: {
            gte: since24h,
          },
          userId: {
            not: null,
          },
        },
        _count: {
          _all: true,
        },
      });

      const riskyUserIds = failedAttempts
        .filter(
          (fa) => fa._count._all >= MAX_FAILED_ATTEMPTS_24H
        )
        .map((fa) => fa.userId);

      if (riskyUserIds.length > 0) {
        const usersMap = new Map(users.map((u) => [u.id, u]));

        const lastFailedPerUser =
          await prisma.loginAttempt.findMany({
            where: {
              success: false,
              createdAt: {
                gte: since24h,
              },
              userId: { in: riskyUserIds },
            },
            orderBy: { createdAt: "desc" },
          });

        const lastFailedMap = new Map();
        for (const a of lastFailedPerUser) {
          if (!lastFailedMap.has(a.userId)) {
            lastFailedMap.set(a.userId, a);
          }
        }

        riskyLogins = failedAttempts
          .filter((fa) => riskyUserIds.includes(fa.userId))
          .map((fa) => {
            const u = usersMap.get(fa.userId);
            const lastFailed = lastFailedMap.get(fa.userId);

            return {
              id: fa.userId,
              email: u?.email ?? lastFailed?.email ?? null,
              failed24h: fa._count._all,
              lastFailedAt: lastFailed?.createdAt ?? null,
              lastPasswordChangeAt:
                u?.lastPasswordChangeAt ?? null,
              locked: u?.locked ?? false,
            };
          });
      }
    } catch (logErr) {
      console.error(
        "ADMIN maintenance /security-overview riskyLogins error",
        logErr
      );
      riskyLogins = [];
    }

    const issuesCount =
      (passwordStats.stalePasswords || 0) +
      (riskyLogins?.length || 0);

    // ================================
    // 3) AUTO ALERTS (stub, pentru frontend)
    // ================================
    const autoAlerts = {
      suspiciousLast24h: 0,
      lastAutoAlertAt: null,
    };

    res.json({
      issuesCount,
      config: {
        maxPasswordAgeDays: MAX_PASSWORD_AGE_DAYS,
        maxFailedAttempts24h: MAX_FAILED_ATTEMPTS_24H,
      },
      passwordStats,
      riskyLogins,
      autoAlerts,
    });
  } catch (e) {
    console.error(
      "ADMIN maintenance /security-overview error",
      e
    );
    res.status(500).json({
      error: "maintenance_security_overview_failed",
    });
  }
});

/**
 * POST /api/admin/maintenance/users/:userId/lock
 */
router.post("/users/:userId/lock", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) {
      return res
        .status(404)
        .json({ error: "user_not_found" });
    }
    if (user.role === "ADMIN") {
      return res
        .status(400)
        .json({ error: "cannot_lock_admin" });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        locked: true,
        status: "SUSPENDED",
      },
      select: { id: true, locked: true, status: true },
    });

    res.json({ ok: true, user: updated });
  } catch (e) {
    console.error(
      "ADMIN maintenance /users/:id/lock error",
      e
    );
    res
      .status(500)
      .json({ error: "maintenance_lock_failed" });
  }
});

/**
 * POST /api/admin/maintenance/users/:userId/unlock
 */
router.post("/users/:userId/unlock", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) {
      return res
        .status(404)
        .json({ error: "user_not_found" });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        locked: false,
        status: "ACTIVE",
      },
      select: { id: true, locked: true, status: true },
    });

    res.json({ ok: true, user: updated });
  } catch (e) {
    console.error(
      "ADMIN maintenance /users/:id/unlock error",
      e
    );
    res
      .status(500)
      .json({ error: "maintenance_unlock_failed" });
  }
});

/**
 * POST /api/admin/maintenance/users/:userId/send-password-reminder
 * -> mail manual: "ar fi bine să îți schimbi parola"
 */
router.post(
  "/users/:userId/send-password-reminder",
  async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          createdAt: true,
          lastPasswordChangeAt: true,
          role: true,
        },
      });

      if (!user) {
        return res
          .status(404)
          .json({ error: "user_not_found" });
      }
      if (!user.email) {
        return res
          .status(400)
          .json({ error: "user_has_no_email" });
      }

      const lastChange =
        user.lastPasswordChangeAt || user.createdAt;
      if (!lastChange) {
        return res
          .status(400)
          .json({ error: "no_password_age" });
      }

      const ageDays = daysBetween(
        new Date(lastChange),
        new Date()
      );

      await sendPasswordStaleReminderEmail({
        to: user.email,
        passwordAgeDays: ageDays,
        maxPasswordAgeDays: MAX_PASSWORD_AGE_DAYS,
      });

      res.json({ ok: true });
    } catch (e) {
      console.error(
        "ADMIN maintenance /users/:id/send-password-reminder error",
        e
      );
      res.status(500).json({
        error:
          "maintenance_send_password_reminder_failed",
      });
    }
  }
);

/**
 * POST /api/admin/maintenance/users/:userId/send-suspicious-login-warning
 * -> mail manual: "au fost mai multe încercări eșuate, ești tu?"
 */
router.post(
  "/users/:userId/send-suspicious-login-warning",
  async (req, res) => {
    try {
      const { userId } = req.params;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
        },
      });

      if (!user) {
        return res
          .status(404)
          .json({ error: "user_not_found" });
      }
      if (!user.email) {
        return res
          .status(400)
          .json({ error: "user_has_no_email" });
      }

      await sendSuspiciousLoginWarningEmail({
        to: user.email,
      });

      res.json({ ok: true });
    } catch (e) {
      console.error(
        "ADMIN maintenance /users/:id/send-suspicious-login-warning error",
        e
      );
      res.status(500).json({
        error:
          "maintenance_send_suspicious_login_warning_failed",
      });
    }
  }
);

/**
 * POST /api/admin/maintenance/users/bulk-password-reminder
 * body: { userIds: string[] }
 */
router.post(
  "/users/bulk-password-reminder",
  async (req, res) => {
    try {
      const userIds = Array.isArray(req.body?.userIds)
        ? req.body.userIds.map(String)
        : [];

      if (!userIds.length) {
        return res
          .status(400)
          .json({ error: "no_user_ids" });
      }

      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          email: true,
          createdAt: true,
          lastPasswordChangeAt: true,
        },
      });

      let sent = 0;
      let skipped = 0;

      for (const u of users) {
        if (!u.email) {
          skipped += 1;
          continue;
        }
        const lastChange =
          u.lastPasswordChangeAt || u.createdAt;
        if (!lastChange) {
          skipped += 1;
          continue;
        }
        const ageDays = daysBetween(
          new Date(lastChange),
          new Date()
        );

        try {
          await sendPasswordStaleReminderEmail({
            to: u.email,
            passwordAgeDays: ageDays,
            maxPasswordAgeDays: MAX_PASSWORD_AGE_DAYS,
          });
          sent += 1;
        } catch (err) {
          console.error(
            "bulk-password-reminder: failed for user",
            u.id,
            err
          );
          skipped += 1;
        }
      }

      res.json({
        ok: true,
        requested: userIds.length,
        matched: users.length,
        sent,
        skipped,
      });
    } catch (e) {
      console.error(
        "ADMIN maintenance /users/bulk-password-reminder error",
        e
      );
      res.status(500).json({
        error:
          "maintenance_bulk_password_reminder_failed",
      });
    }
  }
);

/**
 * POST /api/admin/maintenance/users/bulk-suspicious-login-warning
 * body: { userIds: string[] }
 */
router.post(
  "/users/bulk-suspicious-login-warning",
  async (req, res) => {
    try {
      const userIds = Array.isArray(req.body?.userIds)
        ? req.body.userIds.map(String)
        : [];

      if (!userIds.length) {
        return res
          .status(400)
          .json({ error: "no_user_ids" });
      }

      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          email: true,
        },
      });

      let sent = 0;
      let skipped = 0;

      for (const u of users) {
        if (!u.email) {
          skipped += 1;
          continue;
        }

        try {
          await sendSuspiciousLoginWarningEmail({
            to: u.email,
          });
          sent += 1;
        } catch (err) {
          console.error(
            "bulk-suspicious-login-warning: failed for user",
            u.id,
            err
          );
          skipped += 1;
        }
      }

      res.json({
        ok: true,
        requested: userIds.length,
        matched: users.length,
        sent,
        skipped,
      });
    } catch (e) {
      console.error(
        "ADMIN maintenance /users/bulk-suspicious-login-warning error",
        e
      );
      res.status(500).json({
        error:
          "maintenance_bulk_suspicious_login_warning_failed",
      });
    }
  }
);

/**
 * GET /api/admin/maintenance/review-reports
 * -> listă raportări de review-uri + mici statistici (recenzii PRODUS)
 */
router.get("/review-reports", async (req, res) => {
  try {
    const take = Math.min(Number(req.query.take) || 100, 200);
    const days = Math.max(Number(req.query.days) || 30, 1); // interval pt "recent"
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    );

    // total raportări
    const total = await prisma.reviewReport.count();

    // raportări recente (de ex. ultimele 30 zile)
    const recentCount = await prisma.reviewReport.count({
      where: { createdAt: { gte: since } },
    });

    const items = await prisma.reviewReport.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        reporter: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true, // cine raportează: CUSTOMER / VENDOR / ADMIN
          },
        },
        review: {
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            updatedAt: true, // pentru "editată?"
            status: true,
            user: {
              // autorul recenziei
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
              },
            },
            product: {
              select: {
                id: true,
                title: true,
                service: {
                  select: {
                    id: true,
                    vendor: {
                      select: {
                        id: true,
                        displayName: true,
                        userId: true, // proprietarul magazinului
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    res.json({
      ok: true,
      total,
      recentCount,
      items,
    });
  } catch (e) {
    console.error(
      "ADMIN maintenance /review-reports error",
      e
    );
    res.status(500).json({
      error: "maintenance_review_reports_failed",
    });
  }
});

/**
 * GET /api/admin/maintenance/store-review-reports
 * -> listă raportări pentru recenziile de PROFIL (StoreReview)
 */
router.get("/store-review-reports", async (req, res) => {
  try {
    const take = Math.min(Number(req.query.take) || 100, 200);
    const days = Math.max(Number(req.query.days) || 30, 1);
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000
    );

    const total = await prisma.storeReviewReport.count();

    const recentCount =
      await prisma.storeReviewReport.count({
        where: { createdAt: { gte: since } },
      });

    const items = await prisma.storeReviewReport.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        reporter: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true, // la fel, știm rolul raportorului
          },
        },
        review: {
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            updatedAt: true, // pentru "editată?"
            status: true,
            user: {
              // autorul recenziei de profil
              select: {
                id: true,
                email: true,
                name: true,
                role: true,
              },
            },
            vendor: {
              select: {
                id: true,
                displayName: true,
                userId: true, // user-ul vendorului
              },
            },
          },
        },
      },
    });

    res.json({
      ok: true,
      total,
      recentCount,
      items,
    });
  } catch (e) {
    console.error(
      "ADMIN maintenance /store-review-reports error",
      e
    );
    res.status(500).json({
      error:
        "maintenance_store_review_reports_failed",
    });
  }
});
/**
 * GET /api/admin/maintenance/comment-reports
 * -> listă raportări pentru comentarii (Product Comments)
 */
router.get("/comment-reports", async (req, res) => {
  try {
    const take = Math.min(Number(req.query.take) || 100, 200);
    const days = Math.max(Number(req.query.days) || 30, 1);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const total = await prisma.commentReport.count();
    const recentCount = await prisma.commentReport.count({
      where: { createdAt: { gte: since } },
    });

    const items = await prisma.commentReport.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        reporter: {
          select: { id: true, email: true, name: true, role: true },
        },
        comment: {
          select: {
            id: true,
            text: true,
            createdAt: true,
            userId: true,
            product: { select: { id: true, title: true } },
            user: { select: { id: true, email: true, name: true, role: true } },
            // dacă ai Comment.status:
            // status: true,
          },
        },
      },
    });

    res.json({ ok: true, total, recentCount, items });
  } catch (e) {
    console.error("ADMIN maintenance /comment-reports error", e);
    res.status(500).json({ error: "maintenance_comment_reports_failed" });
  }
});

/**
 * DELETE /api/admin/maintenance/comments/:commentId
 * -> admin șterge definitiv comentariul + rapoartele
 */
router.delete("/comments/:commentId", async (req, res) => {
  try {
    const commentId = String(req.params.commentId || "").trim();
    if (!commentId) return res.status(400).json({ error: "invalid_comment_id" });

    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) return res.status(404).json({ error: "comment_not_found" });

    await prisma.$transaction([
      prisma.commentReport.deleteMany({ where: { commentId } }),
      prisma.comment.delete({ where: { id: commentId } }),
    ]);

    res.json({ ok: true });
  } catch (e) {
    console.error("ADMIN maintenance DELETE /comments/:id error", e);
    res.status(500).json({ error: "maintenance_comment_delete_failed" });
  }
});

/**
 * POST /api/admin/maintenance/comments/:commentId/hide
 * -> ascunde comentariul (doar dacă ai status în Comment)
 */
router.post("/comments/:commentId/hide", async (req, res) => {
  try {
    const commentId = String(req.params.commentId || "").trim();
    if (!commentId) return res.status(400).json({ error: "invalid_comment_id" });

    // dacă nu ai status în schema, scoate complet endpointul ăsta
    const existing = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!existing) return res.status(404).json({ error: "comment_not_found" });

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { status: "HIDDEN" },
    });

    res.json({ ok: true, comment: updated });
  } catch (e) {
    console.error("ADMIN maintenance /comments/:id/hide error", e);
    res.status(500).json({ error: "maintenance_comment_hide_failed" });
  }
});

/**
 * GET /api/admin/maintenance/product-reviews/:reviewId/edit-logs
 * Istoric editări pentru recenzii de PRODUS
 */
router.get("/product-reviews/:reviewId/edit-logs", async (req, res) => {
  try {
    const reviewId = String(req.params.reviewId || "").trim();
    if (!reviewId) {
      return res.status(400).json({ error: "invalid_review_id" });
    }

    const items = await prisma.productReviewEditLog.findMany({
      where: { reviewId },
      orderBy: { createdAt: "desc" },
      include: {
        editor: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });

    res.json({ ok: true, items });
  } catch (e) {
    console.error(
      "ADMIN maintenance /product-reviews/:id/edit-logs error",
      e
    );
    res.status(500).json({
      error: "maintenance_product_review_edit_logs_failed",
    });
  }
});

/**
 * GET /api/admin/maintenance/store-reviews/:reviewId/edit-logs
 * Istoric editări pentru recenzii de PROFIL (STORE)
 */
router.get("/store-reviews/:reviewId/edit-logs", async (req, res) => {
  try {
    const reviewId = String(req.params.reviewId || "").trim();
    if (!reviewId) {
      return res.status(400).json({ error: "invalid_review_id" });
    }

    const items = await prisma.storeReviewEditLog.findMany({
      where: { reviewId },
      orderBy: { createdAt: "desc" },
      include: {
        editor: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        },
      },
    });

    res.json({ ok: true, items });
  } catch (e) {
    console.error(
      "ADMIN maintenance /store-reviews/:id/edit-logs error",
      e
    );
    res.status(500).json({
      error: "maintenance_store_review_edit_logs_failed",
    });
  }
});

/**
 * POST /api/admin/maintenance/product-reviews/:reviewId/hide
 * -> admin ascunde recenzia de produs (status = REJECTED)
 *   + LOG în ProductReviewEditLog (reason: ADMIN_HIDE)
 */
router.post("/product-reviews/:reviewId/hide", async (req, res) => {
  try {
    const reviewId = String(req.params.reviewId || "").trim();
    if (!reviewId) {
      return res.status(400).json({ error: "invalid_review_id" });
    }

    const existing = await prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        rating: true,
        comment: true,
        status: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "review_not_found" });
    }

    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: { status: "REJECTED" },
    });

    // logăm moderarea ca "editare" făcută de ADMIN
    try {
      await prisma.productReviewEditLog.create({
        data: {
          reviewId: existing.id,
          editorId: req.user.sub,
          oldRating: existing.rating,
          newRating: existing.rating,
          oldComment: existing.comment,
          newComment: existing.comment,
          reason: "ADMIN_HIDE",
        },
      });
    } catch (logErr) {
      console.error(
        "Failed to log ADMIN_HIDE for product review",
        reviewId,
        logErr
      );
    }

    res.json({ ok: true, review: updated });
  } catch (e) {
    console.error(
      "ADMIN maintenance /product-reviews/:id/hide error",
      e
    );
    res.status(500).json({
      error: "maintenance_product_review_hide_failed",
    });
  }
});

/**
 * DELETE /api/admin/maintenance/product-reviews/:reviewId
 * -> admin șterge definitiv recenzia de produs
 */
router.delete("/product-reviews/:reviewId", async (req, res) => {
  try {
    const reviewId = String(req.params.reviewId || "").trim();
    if (!reviewId) {
      return res.status(400).json({ error: "invalid_review_id" });
    }

    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      return res.status(404).json({ error: "review_not_found" });
    }

    await prisma.review.delete({
      where: { id: reviewId },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(
      "ADMIN maintenance DELETE /product-reviews/:id error",
      e
    );
    res.status(500).json({
      error: "maintenance_product_review_delete_failed",
    });
  }
});

/**
 * POST /api/admin/maintenance/store-reviews/:reviewId/hide
 * -> admin ascunde recenzia de profil magazin (status = REJECTED)
 *   + LOG în StoreReviewEditLog (reason: ADMIN_HIDE)
 */
router.post("/store-reviews/:reviewId/hide", async (req, res) => {
  try {
    const reviewId = String(req.params.reviewId || "").trim();
    if (!reviewId) {
      return res.status(400).json({ error: "invalid_review_id" });
    }

    const existing = await prisma.storeReview.findUnique({
      where: { id: reviewId },
      select: {
        id: true,
        rating: true,
        comment: true,
        status: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "review_not_found" });
    }

    const updated = await prisma.storeReview.update({
      where: { id: reviewId },
      data: { status: "REJECTED" },
    });

    // logăm moderarea ca "editare" făcută de ADMIN
    try {
      await prisma.storeReviewEditLog.create({
        data: {
          reviewId: existing.id,
          editorId: req.user.sub,
          oldRating: existing.rating,
          newRating: existing.rating,
          oldComment: existing.comment,
          newComment: existing.comment,
          reason: "ADMIN_HIDE",
        },
      });
    } catch (logErr) {
      console.error(
        "Failed to log ADMIN_HIDE for store review",
        reviewId,
        logErr
      );
    }

    res.json({ ok: true, review: updated });
  } catch (e) {
    console.error(
      "ADMIN maintenance /store-reviews/:id/hide error",
      e
    );
    res.status(500).json({
      error: "maintenance_store_review_hide_failed",
    });
  }
});

/**
 * DELETE /api/admin/maintenance/store-reviews/:reviewId
 * -> admin șterge definitiv recenzia de profil magazin
 */
router.delete("/store-reviews/:reviewId", async (req, res) => {
  try {
    const reviewId = String(req.params.reviewId || "").trim();
    if (!reviewId) {
      return res.status(400).json({ error: "invalid_review_id" });
    }

    const review = await prisma.storeReview.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      return res.status(404).json({ error: "review_not_found" });
    }

    await prisma.storeReview.delete({
      where: { id: reviewId },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(
      "ADMIN maintenance DELETE /store-reviews/:id error",
      e
    );
    res.status(500).json({
      error: "maintenance_store_review_delete_failed",
    });
  }
});

router.get("/comments/:commentId/edit-logs", async (req, res) => {
  try {
    const commentId = String(req.params.commentId || "").trim();
    if (!commentId) return res.status(400).json({ error: "invalid_comment_id" });

    const items = await prisma.commentEditLog.findMany({
      where: { commentId },
      orderBy: { createdAt: "desc" },
      include: {
        editor: { select: { id: true, email: true, name: true, role: true } },
      },
    });

    res.json({ ok: true, items });
  } catch (e) {
    console.error("ADMIN maintenance /comments/:id/edit-logs error", e);
    res.status(500).json({ error: "maintenance_comment_edit_logs_failed" });
  }
});
/**
 * GET /api/admin/maintenance/comment-edit-logs
 * -> ultimele editări de comentarii (global feed)
 * query: take=100 (max 200), days=30
 */
router.get("/comment-edit-logs", async (req, res) => {
  try {
    const take = Math.min(Number(req.query.take) || 100, 200);
    const days = Math.max(Number(req.query.days) || 30, 1);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const total = await prisma.commentEditLog.count();
    const recentCount = await prisma.commentEditLog.count({
      where: { createdAt: { gte: since } },
    });

    const items = await prisma.commentEditLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        editor: { select: { id: true, email: true, name: true, role: true } },
        comment: {
          select: {
            id: true,
            text: true,
            createdAt: true,
            userId: true,
            product: { select: { id: true, title: true } },
            user: { select: { id: true, email: true, name: true, role: true } },
          },
        },
      },
    });

    res.json({ ok: true, total, recentCount, items });
  } catch (e) {
    console.error("ADMIN maintenance /comment-edit-logs error", e);
    res.status(500).json({ error: "maintenance_comment_edit_logs_failed" });
  }
});

/**
 * GET /api/admin/maintenance/product-review-edit-logs
 * -> ultimele editări de recenzii produs (global feed)
 * query: take=100 (max 200), days=30
 */
router.get("/product-review-edit-logs", async (req, res) => {
  try {
    const take = Math.min(Number(req.query.take) || 100, 200);
    const days = Math.max(Number(req.query.days) || 30, 1);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const total = await prisma.productReviewEditLog.count();
    const recentCount = await prisma.productReviewEditLog.count({
      where: { createdAt: { gte: since } },
    });

    const items = await prisma.productReviewEditLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        editor: { select: { id: true, email: true, name: true, role: true } },
        review: {
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            updatedAt: true,
            status: true,
            user: { select: { id: true, email: true, name: true, role: true } },
            product: { select: { id: true, title: true } },
          },
        },
      },
    });

    res.json({ ok: true, total, recentCount, items });
  } catch (e) {
    console.error("ADMIN maintenance /product-review-edit-logs error", e);
    res.status(500).json({ error: "maintenance_product_review_edit_logs_failed" });
  }
});

/**
 * GET /api/admin/maintenance/store-review-edit-logs
 * -> ultimele editări de recenzii profil magazin (global feed)
 * query: take=100 (max 200), days=30
 */
router.get("/store-review-edit-logs", async (req, res) => {
  try {
    const take = Math.min(Number(req.query.take) || 100, 200);
    const days = Math.max(Number(req.query.days) || 30, 1);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const total = await prisma.storeReviewEditLog.count();
    const recentCount = await prisma.storeReviewEditLog.count({
      where: { createdAt: { gte: since } },
    });

    const items = await prisma.storeReviewEditLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include: {
        editor: { select: { id: true, email: true, name: true, role: true } },
        review: {
          select: {
            id: true,
            rating: true,
            comment: true,
            createdAt: true,
            updatedAt: true,
            status: true,
            user: { select: { id: true, email: true, name: true, role: true } },
            vendor: { select: { id: true, displayName: true, userId: true } },
          },
        },
      },
    });

    res.json({ ok: true, total, recentCount, items });
  } catch (e) {
    console.error("ADMIN maintenance /store-review-edit-logs error", e);
    res.status(500).json({ error: "maintenance_store_review_edit_logs_failed" });
  }
});

export default router;
