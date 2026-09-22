// backend/src/testing/matchWhere.js
//
// Matcher minimal pentru clauze `where` Prisma, DOAR pentru teste cu DB
// fals: aplică EFECTIV clauza primită (nu întoarce tot ce e seedat), ca
// testele să verifice regulile reale din cod.
//
// Suportă subsetul folosit de rutele de colecții/sitemap: egalitate
// (inclusiv null), OR, AND, `is` (relații 1:1), și operatorii
// in / notIn / gt / gte / lt / lte / not / hasSome / isEmpty / equals.

const OPERATORS = new Set([
  "in",
  "notIn",
  "gt",
  "gte",
  "lt",
  "lte",
  "not",
  "hasSome",
  "isEmpty",
  "equals",
]);

function isOperatorObject(cond) {
  return (
    cond !== null &&
    typeof cond === "object" &&
    !Array.isArray(cond) &&
    !(cond instanceof Date) &&
    Object.keys(cond).length > 0 &&
    Object.keys(cond).every((k) => OPERATORS.has(k))
  );
}

function applyOperators(value, cond) {
  if ("equals" in cond && value !== cond.equals) return false;
  if ("in" in cond && !cond.in.includes(value)) return false;
  if ("notIn" in cond && cond.notIn.includes(value)) return false;
  if ("gt" in cond && !(value > cond.gt)) return false;
  if ("gte" in cond && !(value >= cond.gte)) return false;
  if ("lt" in cond && !(value < cond.lt)) return false;
  if ("lte" in cond && !(value <= cond.lte)) return false;
  if ("not" in cond && value === cond.not) return false;
  if ("hasSome" in cond) {
    const arr = Array.isArray(value) ? value : [];
    if (!cond.hasSome.some((x) => arr.includes(x))) return false;
  }
  if ("isEmpty" in cond) {
    const empty = Array.isArray(value) ? value.length === 0 : true;
    if (empty !== cond.isEmpty) return false;
  }
  return true;
}

export function matchWhere(row, where) {
  return Object.entries(where || {}).every(([key, cond]) => {
    if (key === "OR") {
      // Prisma: OR: [] nu potrivește nimic; OR: [{}] potrivește tot
      return cond.some((sub) => matchWhere(row, sub));
    }
    if (key === "AND") return cond.every((sub) => matchWhere(row, sub));
    if (key === "is") return row != null && matchWhere(row, cond);

    const value = row?.[key];

    if (isOperatorObject(cond)) return applyOperators(value, cond);

    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      // relație imbricată ({ service: { is: {...} } })
      return value != null && matchWhere(value, cond);
    }

    return value === cond;
  });
}

/** `select` -> proiecția rândului (doar cheile cerute). */
export function project(row, select) {
  if (!select) return row;
  return Object.fromEntries(Object.keys(select).map((k) => [k, row[k]]));
}
