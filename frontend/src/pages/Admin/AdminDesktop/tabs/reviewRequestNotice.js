// src/pages/Admin/AdminDesktop/tabs/reviewRequestNotice.js
//
// „Verificare solicitată de vendor” (aiModeration.reviewRequest): textele
// comune zonei din tabul Produse și ferestrei de verificare.

export function formatReviewDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

/*
 * Produsul e deja public (ex. auto-aprobat de AI DUPĂ solicitare): cererea
 * de verificare umană rămâne deschisă - spunem explicit, ca să nu pară
 * rezolvată. null = produsul nu e public.
 */
export function reviewRequestPublicNotice(product) {
  const request = product?.reviewRequest;
  if (!request?.open || String(product?.moderationStatus || "").toUpperCase() !== "APPROVED") return null;

  const approvedBy = request.aiApprovedAt
    ? `Aprobat automat de AI pe ${formatReviewDate(request.aiApprovedAt)}, după solicitare.`
    : "Produsul este deja public.";
  return `${approvedBy} Vânzătorul a cerut verificare umană - solicitarea rămâne deschisă până acționezi.`;
}
