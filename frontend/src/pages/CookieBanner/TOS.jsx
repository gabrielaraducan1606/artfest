// src/pages/Legal/TermsAndConditions.jsx
export default function TermsAndConditions() {
  return (
    <section style={{ maxWidth: 900, margin: "40px auto", padding: "0 16px" }}>
      <h1>Termeni și condiții</h1>

      <p>
        Prin utilizarea platformei Artfest, ești de acord cu următorii termeni.
      </p>

      <h2>Utilizarea platformei</h2>
      <p>
        Utilizatorii trebuie să respecte legislația și regulile platformei.
      </p>

      <h2>Conturi</h2>
      <p>
        Ești responsabil pentru securitatea contului tău și a parolei.
      </p>

      <h2>Răspundere</h2>
      <p>
        Artfest nu este responsabil pentru conținutul furnizat de utilizatori sau
        furnizori.
      </p>

      <p style={{ marginTop: 40, opacity: 0.6 }}>
        Ultima actualizare: {new Date().toLocaleDateString()}
      </p>
    </section>
  );
}