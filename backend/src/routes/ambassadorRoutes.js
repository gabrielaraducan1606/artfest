import { Router } from "express";
import { prisma } from "../db.js";
import { authRequired } from "../api/auth.js";

const router = Router();

/*
=================================
PUBLIC
=================================
*/

router.get("/mission", async (_req, res, next) => {
  try {
    const currentCreators = await prisma.vendor.count();

    const targetCreators = 1000;

    return res.json({
      currentCreators,
      targetCreators,
      progress: Math.min(
        100,
        Math.round((currentCreators / targetCreators) * 100)
      ),
    });
  } catch (err) {
    next(err);
  }
});

/*
=================================
TOP AMBASADORI
=================================
*/

router.get("/leaderboard", async (_req, res, next) => {
  try {
    const items = await prisma.ambassadorProfile.findMany({
      take: 20,
      orderBy: {
        invitedCount: "desc",
      },
      include: {
        vendor: {
          select: {
            displayName: true,
            logoUrl: true,
          },
        },
      },
    });

    res.json(items);
  } catch (err) {
    next(err);
  }
});

/*
=================================
TOP ORASE
=================================
*/

router.get("/cities", async (_req, res, next) => {
  try {
    const cities = await prisma.vendor.groupBy({
      by: ["city"],
      _count: {
        city: true,
      },
      where: {
        isActive: true,
        city: {
          not: null,
        },
      },
      orderBy: {
        _count: {
          city: "desc",
        },
      },
      take: 20,
    });

    res.json(cities);
  } catch (err) {
    next(err);
  }
});

/*
=================================
VENDOR LOGAT
=================================
*/

function makeReferralCode(vendor) {
  const base =
    vendor.displayName
      ?.normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "creator";

  return `${base}-${vendor.id.slice(0, 8)}`;
}

router.get("/me", authRequired, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.sub;

    if (!userId) {
      return res.status(401).json({ error: "unauthorized" });
    }

    const vendor = await prisma.vendor.findUnique({
      where: { userId },
      include: { ambassadorProfile: true },
    });

    if (!vendor) {
      return res.status(404).json({ error: "vendor_not_found" });
    }

    let profile = vendor.ambassadorProfile;

    if (!profile) {
      profile = await prisma.ambassadorProfile.create({
        data: {
          vendorId: vendor.id,
          referralCode: makeReferralCode(vendor),
          city: vendor.city,
          citySlug: vendor.citySlug,
        },
      });
    }

    const appOrigin = process.env.APP_ORIGIN || "https://artfest.ro";

    return res.json({
      referralCode: profile.referralCode,
      referralLink: `${appOrigin}/?auth=register&as=partner&ref=${profile.referralCode}`,
      invitedCount: profile.invitedCount,
      level: profile.level,
      city: profile.city,
      citySlug: profile.citySlug,
    });
  } catch (err) {
    console.error("AMBASSADOR_ME_ERROR:", err);
    return res.status(500).json({
      error: "server_error",
      message: err.message,
      code: err.code,
    });
  }
});

/*
=================================
BENEFICII
=================================
*/

router.get("/benefits", async (_req, res) => {
  res.json({
    levels: [
      {
        level: "FOUNDING",
        title: "Founding Creator",
        minInvites: 0,
        benefits: [
          "Badge Founding Creator",
          "Apari în comunitatea fondatorilor",
        ],
      },
      {
        level: "AMBASSADOR",
        title: "Ambasador",
        minInvites: 3,
        benefits: [
          "Badge Ambasador",
          "Promovare pe canalele ArtFest",
        ],
      },
      {
        level: "GOLD",
        title: "Ambasador Gold",
        minInvites: 10,
        benefits: [
          "Prioritate la promovare",
          "Posibilitatea de a apărea în reclame",
          "Promovare dedicată",
        ],
      },
      {
        level: "ELITE",
        title: "Ambasador Elite",
        minInvites: 25,
        benefits: [
          "Homepage spotlight",
          "Acces prioritar la evenimente",
          "Campanii speciale ArtFest",
        ],
      },
    ],
  });
});

export default router;