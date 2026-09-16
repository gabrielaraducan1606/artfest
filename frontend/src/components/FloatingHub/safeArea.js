// frontend/src/components/FloatingHub/safeArea.js
//
// Citește insets-urile de safe-area (notch/home-indicator) prin
// variabilele CSS `env(safe-area-inset-*)` definite pe `:root` în
// FloatingHub.module.css. Un singur loc de citire, reutilizat atât de
// `useDraggableLauncher` (clamp la drag) cât și de FloatingHub.jsx
// (poziționarea bulei Mesaje/panelului) - nu duplicăm logica de citire.
export function getSafeAreaInsets() {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }

  const computed = window.getComputedStyle(document.documentElement);
  const read = (name) => parseFloat(computed.getPropertyValue(name)) || 0;

  return {
    top: read("--floating-hub-safe-top"),
    bottom: read("--floating-hub-safe-bottom"),
    left: read("--floating-hub-safe-left"),
    right: read("--floating-hub-safe-right"),
  };
}
