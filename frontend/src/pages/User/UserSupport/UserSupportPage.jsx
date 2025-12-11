// src/pages/User/UserSupport/UserSupportPage.jsx
import { useParams } from "react-router-dom";
import SupportPageBase from "../../SupportBase/SupportBasePage"; // <-- verifică path-ul real

export default function UserSupportPage() {
  const { ticketId } = useParams();

  return (
    <SupportPageBase
      supportBase="/api/support"
      listPath="/me/tickets"
      hideNewTicket={false}
      initialTicketId={ticketId || null}
    />
  );
}
