// src/pages/support/VendorSupportPage.jsx
import SupportPageBase from "../../SupportBase/SupportBasePage.jsx";

export default function VendorSupportPage() {
  return (
    <SupportPageBase
      supportBase="/api/vendor/support" // aici se mapează pe VendorSupportRoutes
    />
  );
}
