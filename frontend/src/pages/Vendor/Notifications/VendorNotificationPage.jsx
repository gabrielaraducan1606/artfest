// ex: src/pages/VendorNotificationsPage.jsx
import NotificationsPage from "../Notifications/Notifications";

export default function VendorNotificationsPage() {
  return (
    <NotificationsPage
      basePath="/api/vendor/notifications"
      title="Notificări vendor"
      showSubscriptionBanner={true}
    />
  );
}
