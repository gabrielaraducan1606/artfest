import React from "react";
import Navbar from "../../components/HomePage/Navbar/Navbar";
import Footer from "../../components/HomePage/Footer/Footer";
import styles from "./Termeni.module.css";

const Termeni = () => {
  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <h1 className={styles.title}>Termeni și condiții</h1>
        <p><strong>Ultima actualizare:</strong> 29.07.2025</p>

        <section>
          <h2>1. Despre platformă</h2>
          <p>
            Artfest este o platformă online pentru vânzarea de produse handmade și servicii digitale pentru evenimente.
          </p>
        </section>

        <section>
          <h2>2. Conturi și autentificare</h2>
          <ul>
            <li>Contul este necesar pentru a plasa comenzi sau a vinde produse.</li>
            <li>Datele trebuie să fie reale și actualizate.</li>
            <li>Utilizatorul este responsabil pentru securitatea contului.</li>
          </ul>
        </section>

        <section>
          <h2>3. Conturi de vânzători</h2>
          <ul>
            <li>Vânzătorii pot publica produse proprii după acceptarea termenilor.</li>
            <li>Produsele trebuie să respecte standardele platformei.</li>
          </ul>
        </section>

        <section>
          <h2>4. Produse și comenzi</h2>
          <p>Toate detaliile produselor sunt oferite de vânzători. Comenzile sunt contracte directe între cumpărător și vânzător.</p>
        </section>

        <section>
          <h2>5. Prețuri, plăți și comisioane</h2>
          <p>Prețurile sunt stabilite de vânzători. Artfest poate percepe comisioane pentru vânzări.</p>
        </section>

        <section>
          <h2>6. Politica de retur și rambursare</h2>
          <p>Rambursările se gestionează direct între cumpărător și vânzător.</p>
        </section>

        <section>
          <h2>7. Proprietate intelectuală</h2>
          <p>Este interzisă copierea produselor fără acordul autorului.</p>
        </section>

        <section>
          <h2>8. Confidențialitate (GDPR)</h2>
          <p>Datele personale sunt procesate conform legislației europene GDPR.</p>
        </section>

        <section>
          <h2>9. Limitarea răspunderii</h2>
          <p>Artfest nu răspunde pentru prejudiciile cauzate de utilizarea platformei.</p>
        </section>

        <section>
          <h2>10. Modificări</h2>
          <p>Ne rezervăm dreptul de a modifica acești termeni. Verifică periodic această pagină.</p>
        </section>

        <section>
          <h2>11. Contact</h2>
          <p>📧 Pentru întrebări sau reclamații: <strong>contact@artfest.ro</strong></p>
        </section>
      </main>
      <Footer />
    </>
  );
};

export default Termeni;
