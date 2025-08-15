import api from "./api";

export async function getMe() {
  const { data } = await api.get("/users/me");
  return data; // { role: "seller" | "buyer" | ... }
}
