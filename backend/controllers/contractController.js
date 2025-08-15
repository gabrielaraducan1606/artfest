// controllers/contractController.js
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import Contract from '../models/Contract.js';
import User from '../models/user.js';
import Seller from '../models/Seller.js';
import { savePdfBuffer } from '../utils/pdf.js';

/** Generează un draft PDF simplu din datele Seller-ului */
export const createPreview = async (req, res) => {
  const { version = 'v1.0' } = req.body || {};
  const user = await User.findById(req.user.id).select('email role');
  if (!user) return res.status(401).json({ msg: 'Neautorizat' });

  const seller = await Seller.findOne({ userId: user._id });
  if (!seller) return res.status(400).json({ msg: 'Completează mai întâi profilul de vânzător (pasul 1/2)' });

  // creează PDF simplu
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const titleSize = 18;
  const bodySize = 11;
  let y = 800;

  const draw = (text, size = bodySize, bold = false) => {
    page.drawText(text, {
      x: 50,
      y,
      size,
      font,
      color: rgb(0, 0, 0),
    });
    y -= size + 8;
  };

  draw('CONTRACT DE COLABORARE', titleSize);
  y -= 6;

  draw(`Versiune: ${version}`);
  draw(`Generat: ${new Date().toLocaleString()}`);
  y -= 6;

  draw('Părțile:');
  draw(`- Vânzător: ${seller.shopName} (${seller.username})`);
  draw(`- Email: ${seller.email}`);
  draw(`- CUI: ${seller.cui || '-'}`);
  draw(`- IBAN: ${seller.iban || '-'}`);
  draw(`- Locație: ${seller.city || '-'}, ${seller.country || '-'}`);

  y -= 12;
  draw('Clauze principale:');
  draw('1. Vânzătorul își asumă responsabilitatea pentru produsele listate.');
  draw('2. Platforma procesează comenzi conform termenilor agreați.');
  draw('3. Politici de livrare și retur conform setărilor din cont.');
  draw('4. Taxe și comisioane conform planului de abonament.');

  y -= 20;
  draw('Semnătură vânzător: ____________________________');
  draw('Data: __________________');

  const pdfBytes = await pdfDoc.save();
  const { path, url } = await savePdfBuffer(pdfBytes, `contract-${seller._id}-${Date.now()}`);

  const contract = await Contract.create({
    userId: user._id,
    sellerId: seller._id,
    version,
    status: 'draft',
    pdfPath: path,
    pdfUrl: url,
    snapshot: {
      shopName: seller.shopName,
      username: seller.username,
      companyName: seller.companyName,
      cui: seller.cui,
      iban: seller.iban,
      city: seller.city,
      country: seller.country,
      generatedAt: new Date(),
    },
  });

  res.json({ _id: contract._id, pdfUrl: contract.pdfUrl, status: contract.status });
};

/** Citește contractul */
export const getContract = async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ msg: 'Contract inexistent' });
  if (String(contract.userId) !== String(req.user.id)) {
    return res.status(403).json({ msg: 'Acces interzis' });
  }
  res.json(contract);
};

/** Semnează contractul: inserează semnătura în PDF și marchează status= signed */
export const signContract = async (req, res) => {
  const { id } = req.params;
  const { signerName, signerEmail, signatureImageBase64 } = req.body || {};

  if (!signerName || !signerEmail || !signatureImageBase64) {
    return res.status(400).json({ msg: 'Nume, email și semnătura sunt obligatorii.' });
  }

  const contract = await Contract.findById(id);
  if (!contract) return res.status(404).json({ msg: 'Contract inexistent' });
  if (String(contract.userId) !== String(req.user.id)) {
    return res.status(403).json({ msg: 'Acces interzis' });
  }

  // ia PDF-ul existent și inserează semnătura
  const basePdfBytes = await (await fetch(new URL(`file://${contract.pdfPath}`))).arrayBuffer()
    .catch(async () => {
      // fallback: citește cu fs dacă fetch file:// nu e permis în unele runtime-uri
      const fs = await import('fs');
      return fs.readFileSync(contract.pdfPath);
    });

  const pdfDoc = await PDFDocument.load(basePdfBytes);
  const pages = pdfDoc.getPages();
  const page = pages[0];

  const pngBytes = Buffer.from(signatureImageBase64.split(',')[1], 'base64');
  let sigImage;
  try {
    sigImage = await pdfDoc.embedPng(pngBytes);
  } catch {
    // dacă e jpeg
    sigImage = await pdfDoc.embedJpg(pngBytes);
  }

  const { width, height } = sigImage.scale(1);
  const sigW = 260;
  const ratio = sigW / width;
  const sigH = height * ratio;

  // plasăm semnătura jos
  page.drawImage(sigImage, {
    x: 50,
    y: 120,
    width: sigW,
    height: sigH,
  });

  // text nume + email + data
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  page.drawText(`Semnat de: ${signerName} (${signerEmail})`, {
    x: 50,
    y: 100,
    size: 10,
    font,
    color: rgb(0, 0, 0),
  });
  page.drawText(`Data: ${new Date().toLocaleString()}`, {
    x: 50,
    y: 86,
    size: 10,
    font,
    color: rgb(0, 0, 0),
  });

  const signedBytes = await pdfDoc.save();
  const { path, url } = await savePdfBuffer(signedBytes, `contract-signed-${contract._id}-${Date.now()}`);

  contract.status = 'signed';
  contract.signerName = signerName;
  contract.signerEmail = signerEmail;
  contract.signedAt = new Date();
  contract.pdfSignedPath = path;
  contract.pdfSignedUrl = url;
  await contract.save();

  res.json({ ok: true, pdfUrl: contract.pdfSignedUrl, signedAt: contract.signedAt });
};

/** Descarcă PDF (semnat dacă există, altfel draft) */
export const downloadContract = async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return res.status(404).json({ msg: 'Contract inexistent' });
  if (String(contract.userId) !== String(req.user.id)) {
    return res.status(403).json({ msg: 'Acces interzis' });
  }

  const filePath = contract.pdfSignedPath || contract.pdfPath;
  if (!filePath) return res.status(404).json({ msg: 'Fișier lipsă' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="contract-${contract._id}.pdf"`);
  res.sendFile(filePath, { root: '/' });
};
