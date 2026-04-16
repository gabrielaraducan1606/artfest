import React, { Suspense, lazy } from "react";

const VendorGateModal = lazy(() => import("./VendorGateModal"));
const ProductModal = lazy(() => import("./ProductModal"));

export default function StoreModals({
  gateState,
  setGateState,
  handleAcceptGate,
  prodModalOpen,
  closeProductModal,
  savingProd,
  editingProduct,
  editingOverride,
  prodForm,
  setProdForm,
  categories,
  handleSaveProduct,
  storeSlug,
}) {
  return (
    <Suspense fallback={null}>
      <VendorGateModal
        open={gateState.open}
        onClose={() =>
          setGateState((s) => ({
            ...s,
            open: false,
          }))
        }
        gateLoading={gateState.loading}
        gateErr={gateState.error}
        gateDocs={gateState.docs}
        gateChecks={gateState.checks}
        setGateChecks={(updater) =>
          setGateState((s) => ({
            ...s,
            checks:
              typeof updater === "function"
                ? updater(s.checks)
                : updater,
          }))
        }
        onAccept={handleAcceptGate}
      />

      <ProductModal
        open={prodModalOpen}
        onClose={closeProductModal}
        saving={savingProd}
        editingProduct={editingOverride || editingProduct}
        form={prodForm}
        setForm={setProdForm}
        categories={categories}
        onSave={(e) => handleSaveProduct(e, prodForm)}
        uploadFile={async (f) => {
          const fd = new FormData();
          fd.append("file", f);
          const res = await fetch("/api/upload", {
            method: "POST",
            body: fd,
          });
          const { url } = await res.json();
          return url;
        }}
        storeSlug={storeSlug}
      />
    </Suspense>
  );
}