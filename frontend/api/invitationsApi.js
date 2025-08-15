import api from "../src/components/services/api"; // aici importi instanța axios din index.js-ul tău

export const InvitationsApi = {
  /**
   * Creează un draft nou de invitație.
   * @param {object} payload - Obiectul invitației (defaultInvitation sau modificat)
   * @returns {Promise<{id: string}>}
   */
  createDraft(payload) {
    return api
      .post("/invitations", { payload })
      .then((res) => res.data); // { id }
  },

  /**
   * Ia un draft existent după ID.
   * @param {string} id - ID-ul draftului
   * @returns {Promise<{payload: object, status: string}>}
   */
  getDraft(id) {
    return api
      .get(`/invitations/${id}`)
      .then((res) => res.data);
  },

  /**
   * Actualizează un draft existent.
   * @param {string} id - ID-ul draftului
   * @param {object} payload - Obiectul complet al invitației
   * @returns {Promise<{ok: boolean}>}
   */
  updateDraft(id, payload) {
    return api
      .put(`/invitations/${id}`, { payload })
      .then((res) => res.data);
  },

  /**
   * Inițiază plata pentru invitație.
   * @param {string} id - ID-ul draftului
   * @param {string} [plan="standard"] - Tipul planului de plată
   * @returns {Promise<{checkoutUrl: string}>}
   */
  checkout(id, plan = "standard") {
    return api
      .post(`/invitations/${id}/checkout`, { plan })
      .then((res) => res.data);
  },

  /**
   * Publică invitația (o face accesibilă public prin slug).
   * @param {string} id - ID-ul draftului
   * @returns {Promise<{slug: string}>}
   */
  publish(id) {
    return api
      .post(`/invitations/${id}/publish`)
      .then((res) => res.data);
  },

  /**
   * Ia o invitație publică după slug.
   * @param {string} slug - Slug-ul invitației publice
   * @returns {Promise<{payload: object}>}
   */
  getPublicBySlug(slug) {
    return api
      .get(`/public/invitations/${slug}`)
      .then((res) => res.data);
  },
};
