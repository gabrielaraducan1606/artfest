// src/pages/Admin/adminFilters.js

// numărul de filtre active (valori nevide, diferite de „toate”)
export function countActiveFilters(values = [], emptyValues = ["", "ALL", "all", null, undefined]) {
  return values.filter((value) => !emptyValues.includes(value)).length;
}
