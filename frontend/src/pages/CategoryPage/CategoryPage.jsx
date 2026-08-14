import React from "react";
import { Navigate, useParams } from "react-router-dom";
import ProductsPage from "../Products/Products";
import { getCategoryBySlug } from "../../constants/seoCategories";

export default function CategoryPage() {
  const { slug } = useParams();

  const seoCategory =
    getCategoryBySlug(slug);

  if (!seoCategory?.key) {
    return (
      <Navigate
        to="/produse"
        replace
      />
    );
  }

  return (
    <ProductsPage
      forcedCategory={seoCategory.key}
      forcedSeoCategory={seoCategory}
    />
  );
}