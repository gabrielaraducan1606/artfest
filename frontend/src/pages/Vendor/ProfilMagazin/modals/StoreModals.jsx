import React, { Suspense, lazy } from "react";
import { uploadProductFile } from "../utils/productEditing.js";

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
  sellerData,
  productModalStep = "images",
}) {
  const vendorPreview = {
    displayName: sellerData?.displayName || "",
    address: sellerData?.address || "",
    email: sellerData?.publicEmail || sellerData?.email || "",
  };

  return (
    <Suspense fallback={null}>
      <VendorGateModal
        open={!!gateState.open}
        onClose={() =>
          setGateState((s) => ({
            ...s,
            open: false,
          }))
        }
        gateDocs={gateState.docs}
        onAccept={handleAcceptGate}
        serviceId={gateState.serviceId}
        profile={gateState.profile}
        sellerData={gateState.sellerData}
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
        uploadFile={uploadProductFile}
        storeSlug={storeSlug}
        vendorPreview={vendorPreview}
        initialStep={productModalStep}
      />
    </Suspense>
  );
}