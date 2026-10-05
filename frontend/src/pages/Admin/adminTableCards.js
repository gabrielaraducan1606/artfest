// src/pages/Admin/adminTableCards.js
//
// Tabelele admin pe mobil -> carduri: etichetele coloanelor (data-label)
// puse pe fiecare celulă, folosite de adminMobile.css (td::before).
// Funcții pure pe DOM, fără React (folosite de AdminArea.jsx și în teste).

/*
 * Etichetează celulele unui tabel cu textul header-ului coloanei
 * (data-label), folosit de CSS-ul de mobil (td::before). Tabelele marcate
 * cu data-admin-keep-table păstrează layoutul de tabel și pe mobil.
 * Exportat pentru teste.
 */
export function labelTableCells(table) {
  if (!table || table.hasAttribute("data-admin-keep-table")) return 0;

  const headerRow = table.tHead?.rows?.[table.tHead.rows.length - 1];
  if (!headerRow) return 0;

  const labels = [];
  for (const th of headerRow.cells) {
    const text = (th.textContent || "").replace(/\s+/g, " ").trim();
    const span = Number(th.colSpan) || 1;
    for (let i = 0; i < span; i += 1) labels.push(text);
  }

  let labelled = 0;
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      let column = 0;
      for (const cell of row.cells) {
        const label = labels[column] || "";
        if (label && cell.getAttribute("data-label") !== label) cell.setAttribute("data-label", label);
        if (!label && cell.hasAttribute("data-label")) cell.removeAttribute("data-label");
        // o celulă care ocupă tot rândul (ex. „Nu există date”) nu primește etichetă
        if (Number(cell.colSpan) >= labels.length && labels.length > 1) cell.removeAttribute("data-label");
        column += Number(cell.colSpan) || 1;
        labelled += 1;
      }
    }
  }

  table.setAttribute("data-admin-cards", "");
  return labelled;
}

export function labelAllTables(root) {
  if (!root?.querySelectorAll) return 0;
  let total = 0;
  for (const table of root.querySelectorAll("table")) total += labelTableCells(table);
  return total;
}
