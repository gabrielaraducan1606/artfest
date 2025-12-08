import SupportPageBase from "../../SupportBase/SupportBasePage.jsx";

export default function UserSupportPage() {
  return (
    <SupportPageBase
      // endpoint-ul pentru suport useri (miri)
      supportBase="/api/support"
    />
  );
}
