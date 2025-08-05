// pages/servicii/SeatingSMS.jsx
import { FaChair, FaCommentDots } from "react-icons/fa";
export default function SeatingSMS() {
  return (
    <section className="container">
      <h1><FaChair /> Seating & SMS</h1>
      <p>Planifică mesele și trimite automat SMS cu numărul mesei.</p>
      {/* TODO: import invitați (CSV/Google), auto-seat, edit manual, preview SMS, trimitere */}
      <button className="btn-primary"><FaCommentDots /> Trimite SMS</button>
    </section>
  );
}
