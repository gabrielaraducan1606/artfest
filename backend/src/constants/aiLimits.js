/*
 * Limite folosite de fluxurile AI pentru produse - centralizate aici
 * ca să existe UN SINGUR loc de ajustat după testare, nu constante
 * hardcodate în mai multe fișiere.
 */

/*
 * Numărul maxim de imagini trimise într-un singur request de
 * grupare AI (POST /api/ai/product-batch-group). Peste raționamentul
 * vizual multi-imagine al modelului își pierde din acuratețe, iar
 * costul/latența cresc mult - frontend-ul împarte batch-urile mai
 * mari în loturi succesive de această dimensiune (vezi
 * MAX_BATCH_CLUSTER_IMAGES din vendorProductAi.js pe frontend -
 * trebuie ținută manual în sincron cu valoarea de aici, cele două
 * procese nu pot împărți un import).
 */
export const MAX_BATCH_CLUSTER_IMAGES = 20;
