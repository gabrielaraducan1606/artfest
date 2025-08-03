import express from "express";
import Visitor from "../models/visitor.js";
import geoip from "geoip-lite";
import Product from "../models/product.js";

const router = express.Router();

// 🔹 Salvare vizită (public)
router.post("/", async (req, res) => {
  try {
    const { sellerId, productId } = req.body;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const userAgent = req.headers["user-agent"];
    const geo = geoip.lookup(ip) || {};

    await Visitor.create({
      sellerId,
      productId,
      ip,
      userAgent,
      country: geo.country || "Unknown",
      city: geo.city || "Unknown"
    });

    res.json({ msg: "Vizită înregistrată" });
  } catch (err) {
    console.error("Eroare salvare vizită:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

// 🔹 Statistici vizitatori
router.get("/stats/:sellerId", async (req, res) => {
  try {
    const { sellerId } = req.params;

    const totalVisits = await Visitor.countDocuments({ sellerId });
    const uniqueVisitors = await Visitor.distinct("ip", { sellerId }).then(arr => arr.length);

    const topProducts = await Visitor.aggregate([
      { $match: { sellerId: new mongoose.Types.ObjectId(sellerId) } },
      { $group: { _id: "$productId", visits: { $sum: 1 } } },
      { $sort: { visits: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" }
    ]);

    const visitsByDay = await Visitor.aggregate([
      { $match: { sellerId: new mongoose.Types.ObjectId(sellerId) } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$visitedAt" } },
          visits: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      totalVisits,
      uniqueVisitors,
      topProducts,
      visitsByDay
    });
  } catch (err) {
    console.error("Eroare obținere statistici:", err);
    res.status(500).json({ msg: "Eroare server" });
  }
});

export default router;
