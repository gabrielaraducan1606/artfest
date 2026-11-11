// src/components/Courier/EasyboxLogisticsNote.jsx
//
// Doar informativ, în zonele de expediere și retur: nu selectează o locație și nu schimbă
// nimic la curier sau la AWB. Nu se referă la adresa GPSR (vezi utils/gpsrAddressHelp.js).

export const EASYBOX_LOGISTICS_TEXT =
  "Poți utiliza și un easybox SAMEDAY pentru predarea sau primirea coletelor, dacă serviciul ales permite acest lucru. Nu este necesar să folosești aceeași locație pentru toate operațiunile logistice.";

export default function EasyboxLogisticsNote() {
  return (
    <p
      role="note"
      data-testid="easybox-logistics-note"
      style={{ margin: "0 0 8px", color: "var(--color-muted)", fontSize: "0.85rem", lineHeight: 1.4 }}
    >
      {EASYBOX_LOGISTICS_TEXT}
    </p>
  );
}
