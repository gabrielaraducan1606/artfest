// pages/servicii/AlbumQR.jsx
import { FaQrcode, FaImages } from "react-icons/fa";
export default function AlbumQR() {
  return (
    <section className="container">
      <h1><FaQrcode /> Album QR</h1>
      <p>Colectează poze de la invitați printr-un cod QR unic.</p>
      {/* TODO: generare QR, încărcare guest, galerie live, moderare */}
      <button className="btn-primary"><FaImages /> Generează cod QR</button>
    </section>
  );
}
