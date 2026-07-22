import styles from "../../../components/css/ProductModal.module.css";

export default function ProductWizardNav({
  steps,
  activeStep,
  onStepClick,
  isStepComplete,
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        overflowX: "auto",
        paddingBottom: 10,
        marginBottom: 14,
      }}
    >
      {steps.map((step, index) => {
        const active = step.key === activeStep;
        const complete = isStepComplete?.(step.key);

        return (
          <button
            key={step.key}
            type="button"
            onClick={() => onStepClick(step.key)}
            className={styles.smallBtn}
            style={{
              whiteSpace: "nowrap",
              border: active ? "2px solid #16a34a" : "1px solid #e5e7eb",
              background: active ? "#f0fdf4" : "#fff",
              fontWeight: active ? 800 : 600,
            }}
          >
            {index + 1}. {step.label} {complete ? "✓" : ""}
          </button>
        );
      })}
    </div>
  );
}