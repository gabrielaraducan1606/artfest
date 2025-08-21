export const currency = (v) => new Intl.NumberFormat('ro-RO', { style:'currency', currency:'RON' }).format(v || 0);
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
