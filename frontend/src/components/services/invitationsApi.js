// src/components/services/invitationsApi.js
import api from "./api";

export const InvitationsApi = {
  /**
   * Creează un draft nou de invitație.
   * @param {object} payload - Obiectul invitației (defaultInvitation sau modificat)
   * @returns {Promise<{id: string}>}
   */
  createDraft(payload) {
    return api.post("/invitations", { payload }).then((r) => r.data);
  },

  /**
   * Ia un draft existent după ID.
   * @param {string} id
   * @returns {Promise<{id: string, status: string, payload: object, slug?: string}>}
   */
  getDraft(id) {
    return api.get(`/invitations/${id}`).then((r) => r.data);
  },

  /**
   * Actualizează draftul existent (autosave).
   * @param {string} id
   * @param {object} payload
   * @returns {Promise<{ok: boolean}>}
   */
  updateDraft(id, payload) {
    return api.put(`/invitations/${id}`, { payload }).then((r) => r.data);
  },

  /**
   * Inițiază plata (mock).
   * @param {string} id
   * @param {string} plan
   * @returns {Promise<{checkoutUrl: string}>}
   */
  checkout(id, plan = "standard") {
    return api.post(`/invitations/${id}/checkout`, { plan }).then((r) => r.data);
  },

  /**
   * Publică invitația și întoarce slug.
   * @param {string} id
   * @returns {Promise<{slug: string}>}
   */
  publish(id) {
    return api.post(`/invitations/${id}/publish`).then((r) => r.data);
  },

  /**
   * Ia o invitație publică după slug.
   * @param {string} slug
   * @returns {Promise<{payload: object, slug: string, createdAt: string}>}
   */
  getPublicBySlug(slug) {
    return api.get(`/public/invitations/${slug}`).then((r) => r.data);
  },
};
