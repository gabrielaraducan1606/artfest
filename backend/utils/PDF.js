// src/utils/pdf.js
import PDFDocument from 'pdfkit';

export async function generateContractPDF(snapshot, version, opts = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks = [];
  return await new Promise((resolve, reject) => {
    doc.on('data', (d) => chunks.push(d));
    doc.on('error', reject);
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));

    // HEADER
    doc.fontSize(16).text(`Contract de colaborare – ${snapshot.platform.name}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#666').text(`Versiunea: ${version}`);
    doc.moveDown();

    // Părți
    doc.fillColor('#000').fontSize(12).text('Părțile Contractante', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10)
      .text(`Vânzător: ${snapshot.seller.companyName} (${snapshot.seller.entityType.toUpperCase()})`)
      .text(`CUI: ${snapshot.seller.cui} | Reg. Com.: ${snapshot.seller.registrationNumber}`)
      .text(`Reprezentant: ${snapshot.seller.shopName}`)
      .text(`Sediu: ${snapshot.seller.city}, ${snapshot.seller.country}`)
      .moveDown()
      .text(`Platformă: ${snapshot.platform.name} – ${snapshot.platform.url}`)
      .text(`Plan abonament: ${snapshot.platform.plan || 'Start (trial 1 lună)'}`);

    // Clauze sumare (poți extinde)
    doc.moveDown();
    doc.fontSize(12).text('Obiectul contractului', { underline: true });
    doc.fontSize(10).text('Promovarea și vânzarea produselor handmade prin intermediul platformei.');

    doc.moveDown();
    doc.fontSize(12).text('Obligații', { underline: true });
    doc.fontSize(10).list([
      'Vânzătorul furnizează informații reale despre brand și produse.',
      'Platforma asigură găzduirea paginii publice și suport.',
      'Plățile către vânzător se fac în baza IBAN-ului furnizat.',
    ]);

    // Note afișate (opționale)
    if (snapshot.seller.deliveryNotes || snapshot.seller.returnNotes) {
      doc.moveDown();
      doc.fontSize(12).text('Note afișate cumpărătorilor', { underline: true });
      doc.fontSize(10);
      if (snapshot.seller.deliveryNotes) doc.text(`Livrare: ${snapshot.seller.deliveryNotes}`);
      if (snapshot.seller.returnNotes) doc.text(`Retur: ${snapshot.seller.returnNotes}`);
    }

    // Semnături
    doc.moveDown(2);
    doc.fontSize(12).text('Semnături', { underline: true });
    doc.moveDown();
    doc.fontSize(10).text('Vânzător:');
    if (opts.signatureImageBase64) {
      try {
        const img = Buffer.from(opts.signatureImageBase64.split(',').pop(), 'base64');
        doc.image(img, { width: 160, height: 60 });
      } catch {
        doc.text('(Semnătură indisponibilă)');
      }
    } else {
      doc.text('_______________________________');
    }
    if (opts.signerName) doc.text(`Nume: ${opts.signerName}`);

    doc.moveDown(1);
    doc.text('Platformă:');
    doc.text('_______________________________');

    doc.end();
  });
}
