// backend/src/services/sharedUploadProcessing.js
//
// UN SINGUR rând de procesare a fotografiilor mari pe instanță (citire +
// decodare sharp + R2), comun pentru:
//   - POST /api/upload/products și /api/upload/support (uploadRoutes.js);
//   - POST /api/admin/artfest-fair/inventory/photos (recepția Târgului).
// Înainte, recepția decoda în paralel cu uploadurile de produs, fără rând
// comun și fără protecția de memorie -> risc de OOM pe 512 MB.
// Configurația e aceeași ca înainte (mutată din uploadRoutes.js, neschimbată).

import { createProcessingLimiter, envInteger } from "../middleware/uploadLoadGuards.js";

export const heavyUploadProcessing = createProcessingLimiter({
  concurrency: envInteger("UPLOAD_PROCESSING_CONCURRENCY", 1, 1),
  maxQueue: envInteger("UPLOAD_PROCESSING_MAX_QUEUE", 10, 0),
  // peste termen procesarea e anulată (inclusiv apelul R2) -> 503
  holdTimeoutMs: envInteger("UPLOAD_PROCESSING_HOLD_TIMEOUT_MS", 2 * 60 * 1000, 1),
});
