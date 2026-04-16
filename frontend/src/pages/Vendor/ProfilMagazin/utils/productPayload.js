import { dateOnlyToISO } from "./dateHelpers";

export function buildProductPayload(prodForm) {
  const title = (prodForm.title || "").trim();
  const description = prodForm.description || "";
  const price = Number(prodForm.price);
  const images = Array.isArray(prodForm.images) ? prodForm.images : [];
  const category = (prodForm.category || "").trim();

  const color = (prodForm.color || "").trim() || null;
  const materialMain = (prodForm.materialMain || "").trim() || null;
  const technique = (prodForm.technique || "").trim() || null;
  const styleTags = (prodForm.styleTags || "").trim();
  const occasionTags = (prodForm.occasionTags || "").trim();
  const dimensions = (prodForm.dimensions || "").trim() || null;
  const careInstructions = (prodForm.careInstructions || "").trim() || null;
  const specialNotes = (prodForm.specialNotes || "").trim() || null;

  if (!title) {
    throw new Error("Te rog adaugă un titlu.");
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Preț invalid.");
  }
  if (!category) {
    throw new Error("Selectează categoria produsului.");
  }

  const basePayload = {
    title,
    description,
    price,
    images,
    category,
    currency: prodForm.currency || "RON",
    isActive: prodForm.isActive !== false,
    isHidden: !!prodForm.isHidden,
    acceptsCustom: !!prodForm.acceptsCustom,
    color,
    materialMain,
    technique,
    styleTags,
    occasionTags,
    dimensions,
    careInstructions,
    specialNotes,
  };

  const av = String(prodForm.availability || "READY").toUpperCase();

  const payload = {
    ...basePayload,
    availability: av,
    leadTimeDays: null,
    readyQty: null,
    nextShipDate: null,
  };

  if (av === "MADE_TO_ORDER") {
    const lt = Number(prodForm.leadTimeDays || 0);
    payload.leadTimeDays = Number.isFinite(lt) && lt > 0 ? lt : 1;
  }

  if (av === "READY") {
    if (prodForm.readyQty !== "" && prodForm.readyQty != null) {
      const rq = Number(prodForm.readyQty);
      payload.readyQty = Number.isFinite(rq) && rq >= 0 ? rq : 0;
    }
  }

  if (av === "PREORDER") {
    payload.nextShipDate = prodForm.nextShipDate
      ? dateOnlyToISO(prodForm.nextShipDate)
      : null;
  }

  if (av === "SOLD_OUT") {
    payload.readyQty = 0;
  }

  return payload;
}