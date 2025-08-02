// utils/validators.js
export function validateSellerBody(body) {
  const errors = [];
  const reqd = (k, label = k) => { if (!String(body[k] ?? '').trim()) errors.push(`${label} este obligatoriu`); };

  reqd('shopName', 'Nume magazin');
  reqd('username', 'Username');
  reqd('email', 'Email');
  reqd('password', 'Parola');
  reqd('phone', 'Telefon');
  reqd('category', 'Categorie');
  reqd('city', 'Oraș');
  reqd('country', 'Țară');
  reqd('entityType', 'Tip entitate');
  reqd('companyName', 'Denumire companie');
  reqd('cui', 'CUI');
  reqd('registrationNumber', 'Nr. Registrul Comerțului');
  reqd('iban', 'IBAN');

  if (!['pfa', 'srl'].includes(String(body.entityType).toLowerCase())) {
    errors.push('Tip entitate invalid (pfa/srl)');
  }
  // mini validări
  if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errors.push('Email invalid');
  if (body.username && !/^[a-z0-9._-]{3,30}$/.test(body.username)) errors.push('Username invalid');
  return errors;
}
