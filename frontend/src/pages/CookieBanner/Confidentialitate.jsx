// src/pages/Legal/PrivacyPolicy.jsx
export default function PrivacyPolicy() {
  return (
    <section style={{ maxWidth: 900, margin: "40px auto", padding: "0 16px" }}>
      <h1>Politica de confidențialitate</h1>

      <p>
        Protejăm datele tale personale și le folosim doar pentru a-ți oferi
        servicii mai bune.
      </p>

      <h2>Ce date colectăm</h2>
      <ul>
        <li>Email</li>
        <li>Nume</li>
        <li>Informații de utilizare</li>
      </ul>

      <h2>Cum folosim datele</h2>
      <p>
        Folosim datele pentru crearea contului, comunicare și îmbunătățirea
        platformei.
      </p>

      <h2>Drepturile tale</h2>
      <p>
        Poți solicita oricând ștergerea sau modificarea datelor tale personale.
      </p>

      <p style={{ marginTop: 40, opacity: 0.6 }}>
        Ultima actualizare: {new Date().toLocaleDateString()}
      </p>
    </section>
  );
}