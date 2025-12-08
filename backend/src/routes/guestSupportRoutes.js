import { Router } from "express";
import { prisma } from "../db.js";
import {
  sendGuestSupportConfirmationEmail,
} from "../lib/mailer.js";

export const GuestSupportRoutes = Router();

GuestSupportRoutes.post("/support", async (req, res) => {
  try {
    const { name = "", email = "", subject = "", message = "" } = req.body || {};

    if (!email.trim() || !message.trim()) {
      return res.status(400).json({
        error: "missing_fields",
        message: "Email și mesaj sunt obligatorii.",
      });
    }

    const trimmedEmail = email.trim();
    const trimmedName = name.trim();
    const trimmedSubject = subject.trim() || "Mesaj din formularul de contact (guest)";
    const trimmedMessage = message.trim();

    const existingUser = await prisma.user.findUnique({
      where: { email: trimmedEmail.toLowerCase() },
      select: { id: true },
    });

    const now = new Date();

    const ticket = await prisma.supportTicket.create({
      data: {
        subject: trimmedSubject,
        category: "guest_contact",
        status: "OPEN",
        priority: "MEDIUM",

        audience: "GUEST",

        requesterId: existingUser?.id ?? null,
        requesterName: trimmedName || null,
        requesterEmail: trimmedEmail,

        lastMessageAt: now,

        messages: {
          create: {
            body: trimmedMessage,
            system: false,
            authorId: existingUser?.id ?? null,
          },
        },
      },
    });

    // ✉️ trimitem email de confirmare
    await sendGuestSupportConfirmationEmail({
      to: trimmedEmail,
      name: trimmedName,
      subject: trimmedSubject,
      message: trimmedMessage,
    });

    res.status(201).json({ ok: true, ticketId: ticket.id });
  } catch (e) {
    console.error("guest/support error:", e);
    res.status(500).json({
      error: "server_error",
      message: "A apărut o eroare la trimiterea mesajului.",
    });
  }
});

export default GuestSupportRoutes;
