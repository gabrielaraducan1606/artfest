// scripts/seedServiceTypes.js (sau unde îl folosești tu)

/**
 * Script de seed + migrare pentru tipurile de servicii din platformă.
 *
 * Ce face:
 * 1. Definim/actualizăm mai multe tipuri standard de servicii (cofetărie, decor,
 *    corturi, florărie, muzică, foto/video, special FX, magazin, restaurant).
 *    - Fiecare tip are un "code" (identificator intern), un nume afișat și
 *      un array de "fields" (schema formularului pentru vendor).
 *
 * 2. Rulăm o migrare controlată:
 *    - mapăm coduri vechi la coduri noi (ex: bakery -> bakery_bar);
 *    - mutăm înregistrările din vendorService de pe serviceType vechi pe cel nou,
 *      fără să creăm duplicate pentru același vendor;
 *    - ștergem tipurile vechi din serviceType.
 *
 * Acest script NU este rulat la fiecare request. E gândit să fie rulat manual
 * sau ca parte dintr-un proces de deploy/migrare (ex: "node seedServiceTypes.js").
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Creează sau actualizează un tip de serviciu (serviceType).
 *
 * - code  = identificator intern stabil (ex: "bakery_bar")
 * - name  = denumirea afișată (ex: "Cofetărie / Patiserie / Bar mobil")
 * - fields = schema JSON cu câmpurile formularului pentru acest tip de serviciu
 *
 * Dacă există deja un rând cu același "code", îl actualizează.
 * Dacă nu există, îl creează.
 */
async function upsertType(code, name, fields) {
  await prisma.serviceType.upsert({
    where: { code },
    update: { name, fields },
    create: { code, name, fields },
  });
}

/**
 * Funcția principală:
 * - inserează/actualizează toate serviceType-urile necesare;
 * - rulează migrarea între coduri vechi și noi;
 * - loghează un mesaj la final.
 */
async function main() {
  // 1) Cofetărie / Patiserie / Bar mobil
  await upsertType("bakery_bar", "Cofetărie / Patiserie / Bar mobil", [
    {
      key: "productTypes",
      label: "Tipuri produse",
      type: "checklist_add",
      options: [
        "Torturi",
        "Candy bar",
        "Prăjituri tematice",
        "Fursecuri",
        "Brioșe",
        "Cocktail bar",
        "Cafea bar",
        "Lemonade bar",
      ],
      required: true,
    },
    {
      key: "catalog",
      label: "Catalog (produse)",
      type: "items_list",
      schema: [
        { key: "name", label: "Nume produs", type: "text", required: true },
        { key: "description", label: "Descriere", type: "textarea" },
        { key: "images", label: "Imagini (URL)", type: "list_text" },
        {
          key: "diet",
          label: "Dietetic (marcaje)",
          type: "checklist",
          options: ["Fără gluten", "Fără zahăr", "Vegan"],
        },
      ],
      required: false,
    },
    {
      key: "packages",
      label: "Pachete (opțional)",
      type: "items_list",
      schema: [
        {
          key: "name",
          label: "Nume pachet",
          type: "text",
          required: true,
        },
        { key: "what", label: "Conținut", type: "textarea" },
        { key: "servings", label: "Nr. porții", type: "number" },
      ],
      required: false,
    },
    {
      key: "customizable",
      label: "Personalizare",
      type: "checkbox_with_details",
      detailsKey: "customDetails",
      detailsLabel:
        "Detalii personalizare (tematică, culori, inscripții)",
      required: true,
    },
    {
      key: "leadTimeDays",
      label: "Timp preluare comandă (zile)",
      type: "number",
      required: true,
    },
    {
      key: "delivery",
      label: "Livrare",
      type: "radio",
      options: ["Nu", "Da - gratuit", "Da - contra cost"],
      required: true,
    },
    {
      key: "barExtras",
      label: "Bar mobil — specificații",
      type: "items_list",
      schema: [
        {
          key: "barType",
          label: "Tip bar",
          type: "dropdown",
          options: ["Cocktail", "Cafea", "Limonadă", "Mix"],
          required: true,
        },
        { key: "staffCount", label: "Personal (nr.)", type: "number" },
        {
          key: "alcohol",
          label: "Alcool",
          type: "radio",
          options: ["Nu", "Da (client)", "Da (furnizor)"],
        },
        {
          key: "setupTime",
          label: "Timp montaj (minute)",
          type: "number",
        },
      ],
      required: false,
    },
  ]);

  // 2) Decor evenimente
  await upsertType("decor", "Decor evenimente", [
    {
      key: "services",
      label: "Tip servicii",
      type: "checklist_add",
      options: [
        "Decor lumini",
        "Decor sală",
        "Scenografie",
        "Arcade florale",
        "Foto corner",
      ],
      required: true,
    },
    {
      key: "portfolio",
      label: "Portofoliu (URL poze)",
      type: "list_text",
      required: true,
    },
    {
      key: "included",
      label: "Servicii incluse",
      type: "checklist",
      options: ["Transport", "Montaj", "Demontaj"],
      required: true,
    },
    {
      key: "customDecor",
      label: "Personalizare decor",
      type: "checkbox_with_details",
      detailsKey: "decorDetails",
      detailsLabel: "Detalii tematică/culori",
      required: true,
    },
  ]);

  // 3) Cort evenimente
  await upsertType("tents", "Cort evenimente", [
    {
      key: "tents",
      label: "Corturi disponibile",
      type: "items_list",
      schema: [
        { key: "model", label: "Model", type: "text" },
        {
          key: "capacity",
          label: "Capacitate (persoane)",
          type: "number",
          required: true,
        },
        { key: "size", label: "Dimensiuni (m)", type: "text" },
        { key: "photos", label: "Poze (URL)", type: "list_text" },
      ],
      required: true,
    },
    {
      key: "included",
      label: "Servicii incluse",
      type: "checklist",
      options: ["Transport", "Montaj", "Demontaj"],
      required: true,
    },
    {
      key: "flooring",
      label: "Pardoseală",
      type: "checkbox_with_details",
      detailsKey: "flooringDetails",
      detailsLabel: "Detalii pardoseală",
      required: false,
    },
  ]);

  // 4) Florărie
  await upsertType("florist", "Florărie", [
    {
      key: "productTypes",
      label: "Tip produse",
      type: "checklist_add",
      options: ["Buchete", "Lumânări", "Cocarde", "Aranjamente masă"],
      required: true,
    },
    {
      key: "portfolio",
      label: "Portofoliu (URL poze)",
      type: "list_text",
      required: true,
    },
    {
      key: "customizable",
      label: "Personalizare",
      type: "checkbox_with_details",
      detailsKey: "customDetails",
      detailsLabel: "Tematici/culori",
      required: true,
    },
    {
      key: "packages",
      label: "Pachete (opțional)",
      type: "items_list",
      schema: [
        { key: "name", label: "Nume pachet", type: "text" },
        { key: "what", label: "Conținut", type: "textarea" },
      ],
      required: false,
    },
    {
      key: "priceRange",
      label: "Gama de prețuri (min–max)",
      type: "number_range",
      required: false,
    },
  ]);

  // 5) Formație / DJ / MC / Orchestră / Solist
  await upsertType("entertainment", "Formație / DJ / MC / Orchestră / Solist", [
    {
      key: "kind",
      label: "Tip",
      type: "dropdown",
      options: ["Formație", "DJ", "MC", "Solist", "Orchestră"],
      required: true,
    },
    {
      key: "genres",
      label: "Gen muzical",
      type: "checklist_add",
      options: ["Popular", "Jazz", "Rock", "Pop", "Folk"],
      required: true,
    },
    {
      key: "team",
      label: "Componență echipă",
      type: "text",
      required: true,
    },
    {
      key: "links",
      label: "Portofoliu linkuri",
      type: "links_list",
      required: true,
    },
    {
      key: "packageHours",
      label: "Durată pachet standard (ore)",
      type: "number",
      required: true,
    },
    {
      key: "extraHourCost",
      label: "Cost ore suplimentare (cenți)",
      type: "number",
      required: false,
    },
    {
      key: "customProgram",
      label: "Program personalizat",
      type: "checkbox",
      required: true,
    },

    // ✨ NOU: Vornici (MC) – checkbox cu detalii
    {
      key: "hasVornici",
      label: "Include vornici (MC)",
      type: "checkbox_with_details",
      detailsKey: "vorniciDetails",
      detailsLabel:
        "Detalii vornici (ex. 1–2 persoane, program, limbă)",
      required: false,
    },
  ]);

  // 6) Fotograf / Videograf
  await upsertType("photography", "Fotograf / Videograf", [
    {
      key: "services",
      label: "Tip servicii",
      type: "checklist_add",
      options: ["Foto", "Video", "Drone", "Albume"],
      required: true,
    },
    {
      key: "portfolioLinks",
      label: "Portofoliu linkuri",
      type: "links_list",
      required: true,
    },
    {
      key: "portfolioMedia",
      label: "Upload portofoliu (URL poze/video)",
      type: "list_text",
      required: true,
    },
    {
      key: "standardPackages",
      label: "Pachete standard",
      type: "items_list",
      schema: [
        {
          key: "name",
          label: "Nume pachet",
          type: "text",
          required: true,
        },
        {
          key: "hours",
          label: "Nr. ore",
          type: "number",
          required: true,
        },
        { key: "deliverables", label: "Livrabile", type: "list_text" },
      ],
      required: false,
    },
    {
      key: "hoursRange",
      label: "Nr. ore acoperite (min–max)",
      type: "number_range",
      required: true,
    },
    {
      key: "gear",
      label: "Echipamente",
      type: "text",
    },
    {
      key: "availability",
      label: "Disponibilitate (text)",
      type: "text",
      required: true,
    },
  ]);

  // 7) Fum greu / Cabină foto / Artificii
  await upsertType("special_fx", "Fum greu / Cabină foto / Artificii", [
    {
      key: "services",
      label: "Tip servicii",
      type: "checklist_add",
      options: ["Fum greu", "Cabină foto", "Artificii reci"],
      required: true,
    },
    {
      key: "stdDurationHours",
      label: "Durată standard (ore)",
      type: "number",
      required: true,
    },
    {
      key: "packages",
      label: "Pachete",
      type: "items_list",
      schema: [
        {
          key: "name",
          label: "Nume pachet",
          type: "text",
          required: true,
        },
        { key: "what", label: "Conținut", type: "textarea" },
      ],
      required: false,
    },
    {
      key: "portfolio",
      label: "Portofoliu (URL foto/video)",
      type: "list_text",
      required: true,
    },
    {
      key: "spaceReq",
      label: "Spațiu necesar instalare",
      type: "text",
      required: true,
    },
    {
      key: "specialCond",
      label: "Condiții speciale",
      type: "text",
    },
    {
      key: "eventsPerDay",
      label: "Nr. evenimente/zi",
      type: "number",
    },
  ]);

  // 8) Magazin / Produse
  await upsertType("products", "Magazin / Produse", [
    {
      key: "domain",
      label: "Domeniu",
      type: "dropdown_add",
      options: ["Bijuterii", "Lumânări", "Decor", "Cadouri"],
      required: true,
    },
    {
      key: "businessDescription",
      label: "Descriere business",
      type: "textarea",
      required: true,
    },
    {
      key: "products",
      label: "Produse listate",
      type: "items_list",
      schema: [
        { key: "name", label: "Nume", type: "text", required: true },
        { key: "description", label: "Descriere", type: "textarea" },
        { key: "images", label: "Imagini (URL-uri)", type: "list_text" },
        {
          key: "customizable",
          label: "Personalizare disponibilă",
          type: "checkbox",
        },
      ],
      required: false,
    },
    {
      key: "leadTimeDays",
      label: "Timp execuție minim (zile)",
      type: "number",
      required: true,
    },
  ]);

  // 9) Restaurant / Catering
  await upsertType("restaurant", "Restaurant / Catering", [
    {
      key: "cuisine",
      label: "Specific culinar",
      type: "dropdown",
      options: ["Românesc", "Internațional", "Mediteranean", "Asiatic"],
      required: true,
    },
    {
      key: "serviceTypes",
      label: "Tip servicii",
      type: "checklist",
      options: ["Meniu complet", "Bufet", "Candy bar"],
      required: true,
    },
    {
      key: "halls",
      label: "Săli evenimente",
      type: "items_list",
      schema: [
        {
          key: "name",
          label: "Nume sală",
          type: "text",
          required: true,
        },
        {
          key: "capacity",
          label: "Capacitate",
          type: "number",
          required: true,
        },
        { key: "facilities", label: "Dotări", type: "list_text" },
        { key: "photos", label: "Poze (URL)", type: "list_text" },
      ],
      required: false,
    },
    {
      key: "menu",
      label: "Meniu general (+ note preț)",
      type: "textarea",
      required: true,
    },
    {
      key: "customMenu",
      label: "Personalizare meniu",
      type: "checkbox_with_details",
      detailsKey: "customMenuDetails",
      detailsLabel: "Detalii personalizare",
      required: true,
    },
    {
      key: "tastings",
      label: "Degustări",
      type: "checkbox",
      required: true,
    },
    {
      key: "locationType",
      label: "Locație acoperită",
      type: "dropdown",
      options: ["Restaurant propriu", "Catering extern"],
      required: true,
    },
  ]);

  // --- MIGRARE & CURĂȚARE cu protecție la duplicate ---
  // Mapare: coduri vechi -> coduri noi (serviceType.code)
  const old2new = {
    bakery: "bakery_bar",
    candybar: "bakery_bar",
    decor_tent: "tents",
  };

  for (const [oldCode, newCode] of Object.entries(old2new)) {
    const oldType = await prisma.serviceType.findUnique({
      where: { code: oldCode },
    });
    const newType = await prisma.serviceType.findUnique({
      where: { code: newCode },
    });
    if (!oldType || !newType) continue;

    // Luăm toate serviciile de vendor legate de tipul vechi
    const oldServices = await prisma.vendorService.findMany({
      where: { typeId: oldType.id },
      select: { id: true, vendorId: true },
    });

    for (const s of oldServices) {
      // Verificăm dacă vendorul are deja un serviciu pe tipul nou
      const alreadyNew = await prisma.vendorService.findFirst({
        where: { vendorId: s.vendorId, typeId: newType.id },
        select: { id: true },
      });

      if (alreadyNew) {
        // Dacă există deja un serviciu de tip nou pentru același vendor,
        // ștergem rândul vechi pentru a evita duplicatele.
        await prisma.vendorService.delete({ where: { id: s.id } });
      } else {
        // Altfel, migrăm serviciul vechi la tipul nou (update typeId)
        await prisma.vendorService.update({
          where: { id: s.id },
          data: { typeId: newType.id },
        });
      }
    }

    // Ștergem tipul vechi după ce am migrat toate serviciile
    await prisma.serviceType.deleteMany({ where: { id: oldType.id } });
  }

  console.log("✅ Service types: upsert + migrate + clean done.");
}

// Rulăm scriptul și ne asigurăm că închidem conexiunea la DB corect
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
