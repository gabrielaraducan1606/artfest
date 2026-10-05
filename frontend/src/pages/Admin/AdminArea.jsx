// src/pages/Admin/AdminArea.jsx
//
// Container comun pentru toate paginile ADMIN (montat în AdminLayout, App.jsx):
//  - marchează zona admin (body[data-admin-area]) - regulile de mobil din
//    adminMobile.css se aplică DOAR aici, inclusiv modalelor randate prin
//    portal direct în <body>;
//  - pe mobil, tabelele admin devin carduri: fiecare celulă primește automat
//    eticheta coloanei (data-label din <th>), fără să modificăm fiecare tabel.
// Doar prezentare - fără logică de business, fără API.

import { useEffect, useRef } from "react";
import "./adminMobile.css";
import { labelAllTables } from "./adminTableCards.js";

export function AdminArea({ children }) {
  const ref = useRef(null);

  useEffect(() => {
    const body = document.body;
    body.setAttribute("data-admin-area", "");

    // tabelele apar / se schimbă după încărcarea datelor și în modale (portal în body)
    let scheduled = false;
    const run = () => {
      scheduled = false;
      labelAllTables(body);
    };
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(run);
    };

    run();
    const observer = new MutationObserver(schedule);
    observer.observe(body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      body.removeAttribute("data-admin-area");
    };
  }, []);

  return (
    <div ref={ref} className="admin-area">
      {children}
    </div>
  );
}

export default AdminArea;
