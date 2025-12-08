// backend/src/routes/supportPublicRoutes.js
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";

export const PublicSupportRoutes = Router();

/**
 * Body:
 *  - name: numele persoanei (guest)
 *  - email: email de contact
 *  - subject: subiect tichet
 *  - message: descriere problemă
 */
const bodyPublicTicket = z.object({
  name: z.string().min(2, "Numele este prea scurt"),
  email: z.string().email("Email invalid"),
  subject: z.string().min(3, "Subiect prea scurt"),
  message: z.string().min(1, "Mesajul este obligatoriu"),
});

/** POST /api/public/support/tickets  (fără autentificare) */
PublicSupportRoutes.post("/tickets", async (req, res) => {
  const parsed = bodyPublicTicket.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "bad_request",
      details: parsed.error.flatten(),
    });
  }

  const { name, email, subject, message } = parsed.data;

  try {
    const ticket = await prisma.supportTicket.create({
      data: {
        // ⚠️ asta presupune că în Prisma:
        // - requesterId este opțional
        // - ai câmpuri requesterName, requesterEmail
        // - enum SupportAudience are GUEST
        requesterId: null,
        vendorId: null,
        audience: "GUEST",
        requesterName: name,
        requesterEmail: email,
        subject,
        category: "general",
        priority: "MEDIUM",
        status: "OPEN",
        lastMessageAt: new Date(),
        messages: {
          create: {
            authorId: null, // guest
            system: false,
            body: message,
          },
        },
      },
      select: { id: true, createdAt: true },
    });

    // opțional: poți trimite notificare la admin aici

    res.status(201).json({
      ok: true,
      ticketId: ticket.id,
    });
  } catch (e) {
    console.error("public create ticket error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

/**
 * FAQ public – dacă vrei să expui și aici.
 * Poți folosi același handler ca la vendor/user sau să-l chemi direct pe acesta din frontend.
 */
PublicSupportRoutes.get("/faqs", async (req, res) => {
  const q = (req.query.q ?? "").toString();

  try {
    const items = await prisma.supportFaq.findMany({
      where: {
        isActive: true,
        ...(q
          ? {
              OR: [
                { q: { contains: q, mode: "insensitive" } },
                { a: { contains: q, mode: "insensitive" } },
                {
                  tags: {
                    hasSome: q.toLowerCase().split(/\s+/).filter(Boolean),
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });

    res.json({ items });
  } catch (e) {
    console.error("public faqs error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

export default PublicSupportRoutes;
