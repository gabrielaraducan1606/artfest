import api from "./api";

/** Status curent { step, completed } */
export async function getOnboardingStatus() {
  const { data } = await api.get("/seller/onboarding/status");
  return data || { step: 1, completed: false };
}

/** Salvare incrementală pe pasul curent */
export async function saveOnboardingStep(step, data) {
  const { data: res } = await api.post("/seller/onboarding/save", { step, data });
  return res; // { ok, nextStep, shopId? }
}

/** Finalizare + publicare */
export async function completeOnboarding() {
  const { data } = await api.post("/seller/onboarding/complete");
  return data; // { ok, slug }
}
