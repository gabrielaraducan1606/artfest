import Modal from "../ui/Modal";
import styles from "../components/css/ProductModal.module.css";

import ProductModalWizard from "./ProductModal/ProductModalWizard";
import AiManualChoiceModal from "./ProductModal/components/AiManualChoiceModal.jsx";

/*
 * Plumbing-ul complet (poze/reorder/AI, quote schema CRUD, optiuni,
 * avertizare pret, submit) a fost extras in useProductEditorController.js
 * ca sa fie reutilizat STRICT (nu duplicat) de VendorProductWizard in
 * mode="edit" - vezi acel fisier pentru toata logica. ProductModal e
 * acum doar un consumator subtire, comportamentul lui NU s-a schimbat.
 */
import { useProductEditorController } from "./useProductEditorController.js";

export default function ProductModal({
  open,
  onClose,
  saving,
  editingProduct,
  form,
  setForm,
  categories = [],
  onSave,
  uploadFile,
  storeSlug,
}) {
  const controller = useProductEditorController({
    open,
    onClose,
    editingProduct,
    form,
    setForm,
    categories,
    onSave,
    uploadFile,
    storeSlug,
  });

  const {
    activeStep,
    setActiveStep,
    aiLoading,
    manualPromptOpen,
    closeManualPrompt,
    continueManualEditing,
    chooseAiCompletion,
    aiImageLoading,
    aiImagePreview,
    setAiImagePreview,
    handleAiEnhanceImage,
    useAiImage,
    priceSuggestion,
    setPriceSuggestion,
    priceWarningConfirmed,
    setPriceWarningConfirmed,
    hasPriceWarning,
    goToCostsProfit,
    uploadingImages,
    uploadInfo,
    draftKey,
    mainImageReadyForAi,
    allImagesReadyForAi,
    resolveProductImageUrl,
    setMainImage,
    removeImage,
    onDragStart,
    onDragOver,
    onDrop,
    onFilesPicked,
    onPasteImages,
    updateField,
    handleAiAnalyze,
    options,
    getLabelFor,
    materialOptions,
    techniqueOptions,
    colorOptions,
    styleOptions,
    occasionOptions,
    careOptions,
    handleSubmit,
    addQuoteField,
    updateQuoteField,
    removeQuoteField,
    addQuoteFieldOption,
    updateQuoteFieldOption,
    removeQuoteFieldOption,
  } = controller;

  return (
  <>
    <Modal
      open={open}
      onClose={() =>
        !saving
          ? onClose()
          : null
      }
      maxWidth={760}
    >
      <div
        className={
          styles.modalHeader
        }
      >
        <h3
          className={
            styles.modalTitle
          }
        >
          {editingProduct
            ? "Editează produs"
            : "Adaugă produs"}
        </h3>

        <button
          className={
            styles.modalClose
          }
          onClick={() =>
            !saving
              ? onClose()
              : null
          }
          disabled={saving}
          type="button"
          aria-label="Închide"
        >
          ×
        </button>
      </div>

      <div
        className={
          styles.modalBody
        }
      >
        <ProductModalWizard
          form={form}
          setForm={setForm}
          quoteSchema={
  Array.isArray(
    form.quoteSchema
  )
    ? form.quoteSchema
    : []
}

addQuoteField={
  addQuoteField
}

updateQuoteField={
  updateQuoteField
}

removeQuoteField={
  removeQuoteField
}

addQuoteFieldOption={
  addQuoteFieldOption
}

updateQuoteFieldOption={
  updateQuoteFieldOption
}

removeQuoteFieldOption={
  removeQuoteFieldOption
}
          saving={saving}
          editingProduct={
            editingProduct
          }
          activeStep={activeStep}
          setActiveStep={
            setActiveStep
          }
          handleSubmit={
            handleSubmit
          }
          onClose={onClose}
          draftKey={draftKey}
          getLabelFor={
            getLabelFor
          }
          options={options}
          aiImagePreview={
            aiImagePreview
          }
          aiImageLoading={
            aiImageLoading
          }
          aiLoading={aiLoading}
          uploadInfo={uploadInfo}
          allImagesReadyForAi={
            allImagesReadyForAi
          }
          mainImageReadyForAi={
            mainImageReadyForAi
          }
          resolveProductImageUrl={
            resolveProductImageUrl
          }
          onPasteImages={
            onPasteImages
          }
          onFilesPicked={
            onFilesPicked
          }
          onDragStart={
            onDragStart
          }
          onDragOver={
            onDragOver
          }
          onDrop={onDrop}
          setMainImage={
            setMainImage
          }
          removeImage={
            removeImage
          }
          handleAiAnalyze={
            handleAiAnalyze
          }
          handleAiEnhanceImage={
            handleAiEnhanceImage
          }
          useAiImage={
            useAiImage
          }
          updateField={
            updateField
          }
          materialOptions={
            materialOptions
          }
          techniqueOptions={
            techniqueOptions
          }
          styleOptions={
            styleOptions
          }
          occasionOptions={
            occasionOptions
          }
          careOptions={
            careOptions
          }
          colorOptions={
            colorOptions
          }
          uploadingImages={
            uploadingImages
          }
          hasPriceWarning={
            hasPriceWarning
          }
          priceSuggestion={
            priceSuggestion
          }
          priceWarningConfirmed={
            priceWarningConfirmed
          }
          onGoToCostsProfit={
            goToCostsProfit
          }
          setAiImagePreview={
            setAiImagePreview
          }
          setPriceSuggestion={
            setPriceSuggestion
          }
          setPriceWarningConfirmed={
            setPriceWarningConfirmed
          }
        />
            </div>
    </Modal>

    <AiManualChoiceModal
      open={manualPromptOpen}
      onClose={closeManualPrompt}
      onUseAi={chooseAiCompletion}
      onContinueManual={
        continueManualEditing
      }
      aiLoading={aiLoading}
      uploadingImages={
        uploadingImages
      }
      hasImages={
        (form.images || []).length > 0
      }
    />
  </>
);
}
