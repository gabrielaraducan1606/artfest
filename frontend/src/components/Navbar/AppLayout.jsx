import {
  Outlet,
} from "react-router-dom";
import { lazy, Suspense } from "react";

import Navbar from "./Navbar";
import Footer from "../Footer/Footer";

// Widget-uri de asistent AI - grele (includ printre altele fluxul
// de căutare vizuală de produse, ~2000+ linii), dar folosite doar
// când userul le deschide explicit. Lazy, ca să nu intre în
// bundle-ul inițial al fiecărei pagini.
const AiAssistant = lazy(() => import("../AIAssistant/AiAssistant.jsx"));
const VendorAssistant = lazy(() =>
  import("../AIAssistant/VendorAIAssistant/VendorAssistant.jsx")
);
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

      <Suspense fallback={null}>
        {isVendor ? (
          <VendorAssistant />
        ) : (
          <AiAssistant
            isVendor={false}
            isAuthenticated={Boolean(me)}
          />
        )}
      </Suspense>
    </CurrentEntityProvider>
  );
}