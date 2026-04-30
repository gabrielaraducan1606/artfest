import React from "react";
import { Navigate, useParams } from "react-router-dom";
import { getCategoryBySlug } from "../../constants/seoCategories";

export default function CategoryPage() {
  const { slug } = useParams();
  const seoCategory = getCategoryBySlug(slug);

  if (!seoCategory?.key) {
    return <Navigate to="/produse" replace />;
  }

  return (
    <Navigate
      to={`/produse?categorie=${encodeURIComponent(seoCategory.key)}&page=1`}
      replace
    />
  );
}