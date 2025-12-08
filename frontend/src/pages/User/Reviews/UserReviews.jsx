// src/components/reviews/UserProductReviews.jsx
import { useEffect, useState, useCallback } from "react";
import ReviewsSection from "./ReviewsSection";

export default function UserProductReviews({ productId, me }) {
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({ c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, avg: 0 });
  const [total, setTotal] = useState(0);
  const [rating, setRating] = useState(0);
  const [query, setQuery] = useState({
    sort: "relevant",
    filter: { verified: false, star: 0 },
    page: 0,
  });

  const pageSize = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("sort", query.sort);
    params.set("skip", String(query.page * pageSize));
    params.set("take", String(pageSize));
    if (query.filter.verified) params.set("verified", "1");
    if (query.filter.star) params.set("star", String(query.filter.star));

    const [resReviews, resAvg] = await Promise.all([
      fetch(`/api/public/product/${productId}/reviews?` + params.toString()),
      fetch(`/api/public/product/${productId}/reviews/average`),
    ]);

    const dataReviews = await resReviews.json();
    const dataAvg = await resAvg.json();

    setReviews(dataReviews.items || []);
    setStats(dataReviews.stats || { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0});
    setTotal(dataReviews.total || 0);
    setRating(dataAvg.average || 0);
    setLoading(false);
  }, [productId, query]);

  useEffect(() => {
    fetchData().catch(console.error);
  }, [fetchData]);

  function handleChangeQuery(delta) {
    setQuery((old) => ({
      ...old,
      ...delta,
      filter: { ...old.filter, ...(delta.filter || {}) },
      page: delta.page ?? 0, // reset pagina dacă schimb filtrul/sortarea
    }));
  }

  function handleOptimisticAdd(tempReview) {
    setReviews((cur) => [tempReview, ...cur]);
    setTotal((t) => t + 1);
  }

  async function handleSubmit({ rating, comment }) {
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId, rating, comment }),
    });
    if (!res.ok) {
      // poți pune un toast / alert
      console.error("Failed to submit review");
    } else {
      // recalculezi din back pentru a avea stats corecte
      await fetchData();
    }
  }

  async function handleHelpful(reviewId) {
    await fetch(`/api/reviews/${reviewId}/helpful`, { method: "POST" });
    setReviews((cur) =>
      cur.map((r) => (r.id === reviewId ? { ...r, helpfulCount: (r.helpfulCount || 0) + 1 } : r)),
    );
  }

  async function handleReport(reviewId) {
    const reason = window.prompt("Motivul raportării:");
    if (!reason) return;
    await fetch(`/api/reviews/${reviewId}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    // opțional: toast "Mulțumim pentru raportare"
  }

  if (loading && !reviews.length) return <p>Se încarcă recenziile...</p>;

  return (
    <ReviewsSection
      rating={rating}
      reviews={reviews}
      totalCount={total}
      stats={stats}
      canWrite={!!me}        // user logat poate scrie
      isVendorView={false}   // IMPORTANT: modul user
      me={me}
      onSubmit={handleSubmit}
      onOptimisticAdd={handleOptimisticAdd}
      onHelpful={handleHelpful}
      onReport={handleReport}
      onChangeQuery={handleChangeQuery}
    />
  );
}
