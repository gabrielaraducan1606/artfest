// src/features/smartListing/smartListingHelp.js
//
// „Cere ajutor echipei Artfest” -> sistemul EXISTENT de suport. Logica e comună cu
// ProductModal (utils/productHelpRequest.js): tichet „Ajutor adăugare produs”, cu mesajul
// vânzătorului nemodificat și ciorna locală ca referință. NU creează și NU publică produsul.

export {
  HELP_CATEGORY,
  HELP_ENDPOINT,
  buildHelpTicket,
  buildSavedProductHelpTicket,
  openSavedProductHelpTicket,
  requestArtfestHelp,
} from "../../utils/productHelpRequest.js";
