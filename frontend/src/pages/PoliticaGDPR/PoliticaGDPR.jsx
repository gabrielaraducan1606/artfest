import React from "react";
import Navbar from "../../components/Navbar/Navbar";
import Footer from "../../components/Footer/Footer";
import styles from "../Termeni/Termeni"; // reutilizăm stilul pentru consistență

const GDPR = () => {
  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <h1 className={styles.title}>Politica de Confidențialitate (GDPR)</h1>
        <p><strong>Ultima actualizare:</strong> 29.07.2025</p>

        <section>
          <h2>1. Ce date colectăm?</h2>
          <ul>
            <li>Nume, adresă de email, parolă</li>
            <li>Date legate de comenzile și preferințele tale</li>
            <li>Adresa IP, informații despre browser și locație aproximativă</li>
          </ul>
        </section>

        <section>
          <h2>2. Cum folosim aceste date?</h2>
          <p>Folosim datele pentru a furniza servicii, livrare produse, procesare comenzi și îmbunătățirea experienței pe platformă.</p>
        </section>

        <section>
          <h2>3. Cât timp păstrăm datele?</h2>
          <p>Datele sunt păstrate pe durata contului tău sau până când soliciți ștergerea acestora.</p>
        </section>

        <section>
          <h2>4. Cine are acces la date?</h2>
          <p>Doar personalul autorizat al platformei și furnizorii noștri de servicii (ex: găzduire, plăți) au acces, cu respectarea obligațiilor legale.</p>
        </section>

        <section>
          <h2>5. Drepturile tale</h2>
          <ul>
            <li>Dreptul de acces</li>
            <li>Dreptul de rectificare</li>
            <li>Dreptul de ștergere („dreptul de a fi uitat”)</li>
            <li>Dreptul de opoziție</li>
            <li>Dreptul la portabilitate</li>
          </ul>
        </section>

        <section>
          <h2>6. Contact</h2>
          <p>Pentru orice întrebări privind datele tale: <strong>gdpr@artfest.ro</strong></p>
        </section>
      </main>
      <Footer />
    </>
  );
};

export default GDPR;
