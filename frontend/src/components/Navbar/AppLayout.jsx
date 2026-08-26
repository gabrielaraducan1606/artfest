import {
  Outlet,
} from "react-router-dom";

import Navbar from "./Navbar";
import Footer from "../Footer/Footer";

import AiAssistant from "../AIAssistant/AiAssistant.jsx";
import VendorAssistant from "../AIAssistant/VendorAIAssistant/VendorAssistant.jsx";
import { CurrentEntityProvider } from "../AIAssistant/CurrentEntityContext.jsx";

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

  return (
    <CurrentEntityProvider>
      <Navbar />

      <main>
        <Outlet />
      </main>

      <Footer />

      {isVendor ? (
        <VendorAssistant />
      ) : (
        <AiAssistant
          isVendor={false}
        />
      )}
    </CurrentEntityProvider>
  );
}