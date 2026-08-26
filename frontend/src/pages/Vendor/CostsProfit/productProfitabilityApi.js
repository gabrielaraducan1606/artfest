// src/pages/Vendor/CostsProfit/productProfitabilityApi.js

import { api } from "../../../lib/api.js";

export async function fetchProductProfitability({
  page = 1,
  pageSize = 20,
  filter = "",
  sortBy = "name",
  sortDir = "asc",
} = {}) {
  const params = new URLSearchParams();

  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  params.set("sortBy", sortBy);
  params.set("sortDir", sortDir);

  if (filter) {
    params.set("filter", filter);
  }

  const data = await api(
    `/api/vendor/products/profitability?${params.toString()}`
  );

  return {
    items: Array.isArray(data?.items)
      ? data.items
      : [],

    page: data?.page ?? page,
    pageSize: data?.pageSize ?? pageSize,
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 1,
  };
}
