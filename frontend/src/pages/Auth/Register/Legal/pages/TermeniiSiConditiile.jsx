// frontend/src/pages/termenii-si-conditiile.jsx
export default function Termeni() {
  const base = import.meta.env.VITE_API_BASE || "http://localhost:5000";
  return (
    <iframe
      title="Termeni și condiții"
      src={`${base}/legal/tos.html`}
      style={{ width: "100%", height: "100vh", border: 0 }}
    />
  );
}
