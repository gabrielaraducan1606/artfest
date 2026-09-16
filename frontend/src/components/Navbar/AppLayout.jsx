import {
  Outlet,
} from "react-router-dom";

import Navbar from "./Navbar";
import Footer from "../Footer/Footer";
import FloatingHub from "../FloatingHub/FloatingHub.jsx";
import { CurrentEntityProvider } from "../AIAssistant/CurrentEntityContext.jsx";
import { UnreadMessagesProvider } from "../../features/messages/hooks/UnreadMessagesProvider.jsx";

import {
  useAuth,
} from "../../pages/Auth/Context/context.js";

export default function AppLayout() {
  const {
    me,
  } = useAuth();

  const isVendor =
    me?.role ===
    "VENDOR";

  /*
   * FAZA 3 - influencerul reutilizează EXACT AiAssistant.jsx (nu un
   * widget separat) - doar primește rolul real, ca resolveAssistantAction
   * (assistantActionRegistry.js) și quick actions să știe să-l
   * trateze diferit de un USER simplu.
   */
  const isInfluencer =
    me?.role ===
    "INFLUENCER";

  return (
    <CurrentEntityProvider>
      <UnreadMessagesProvider>
        <Navbar />

        <main>
          <Outlet />
        </main>

        <Footer />

        <FloatingHub me={me} isVendor={isVendor} isInfluencer={isInfluencer} />
      </UnreadMessagesProvider>
    </CurrentEntityProvider>
  );
}