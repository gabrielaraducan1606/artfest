// frontend/src/pages/confidentialitate.jsx
export default function Confidentialitate() {
  const base = import.meta.env.VITE_API_BASE || "http://localhost:5000";
  return (
    <iframe
      title="Politica de confidențialitate"
      src={`${base}/legal/privacy.html`}
      style={{ width: "100%", height: "100vh", border: 0 }}
    />
  );
}
