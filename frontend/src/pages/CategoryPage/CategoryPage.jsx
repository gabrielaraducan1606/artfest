import React from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import ProductsPage from "../Products/Products";
import { getCategoryBySlug } from "../../constants/seoCategories";
import { parsePage } from "../../utils/seo/pagination.js";

export default function CategoryPage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();

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

  /*
   * Paginare crawlabilă: /categorii/:slug?page=N. Pagina de START vine din
   * URL, dar DOAR pe vizualizarea curată a categoriei (fără filtre/căutare
   * în URL); cu filtre, paginarea prin ?page= nu se aplică (pornim de la 1,
   * ca înainte). Valori invalide (0, negative, NaN...) => pagina 1.
   *
   * `key` remontează Products la schimbarea paginii (linkurile Pagina
   * anterioară/următoare): stare proaspătă, fără să atingem mașina de stare
   * a listei. Infinite scroll-ul continuă de la pagina de start în sus.
   */
  const onlyPageParam = [...searchParams.keys()].every((k) => k === "page");
  const startPage = onlyPageParam
    ? parsePage(searchParams.get("page")).page
    : 1;

  return (
    <ProductsPage
      key={`${seoCategory.key}:${startPage}`}
      forcedCategory={seoCategory.key}
      forcedSeoCategory={seoCategory}
      startPage={startPage}
    />
  );
}
