// src/components/reviews/VendorProductReviews.jsx
import { useEffect, useState, useCallback } from "react";
import ReviewsSection from "./ReviewsSection";

export default function VendorProductReviews({ productId, me }) {
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState([]);
  const [stats, setStats] = useState({
    c1: 0,
    c2: 0,
    c3: 0,
    c4: 0,
    c5: 0,
    avg: 0,
  });
  const [total, setTotal] = useState(0);
  const [rating, setRating] = useState(0);
  const [query, setQuery] = useState({
    sort: "relevant",
    filter: { verified: false, star: 0, noReply: false, lowRatingOnly: false },
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
      fetch(
        `/api/public/product/${productId}/reviews?` + params.toString()
      ),
      fetch(`/api/public/product/${productId}/reviews/average`),
    ]);

    const dataReviews = await resReviews.json();
    const dataAvg = await resAvg.json();

    let items = dataReviews.items || [];

    // Filtru „fără răspuns” aplicat doar în UI
    if (query.filter.noReply) {
      items = items.filter((r) => !r.reply);
    }

    // Filtru „doar recenzii ≤ 3 stele” – doar pentru vendor
    if (query.filter.lowRatingOnly) {
      items = items.filter((r) => (r.rating ?? 0) <= 3);
    }

    setReviews(items);
    setStats(
      dataReviews.stats || { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0, avg: 0 }
    );
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
      page: delta.page ?? 0,
    }));
  }

  async function handleVendorReply(reviewId, text) {
    const res = await fetch(`/api/vendor/reviews/${reviewId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error("Failed to save reply");
      alert("Nu am putut salva răspunsul.");
      return;
    }
    const data = await res.json();
    setReviews((cur) =>
      cur.map((r) =>
        r.id === reviewId ? { ...r, reply: data.reply } : r
      )
    );
  }

  async function handleVendorDeleteReply(reviewId) {
    const ok = window.confirm("Sigur vrei să ștergi răspunsul?");
    if (!ok) return;
    const res = await fetch(`/api/vendor/reviews/${reviewId}/reply`, {
      method: "DELETE",
    });
    if (!res.ok) {
      console.error("Failed to delete reply");
      alert("Nu am putut șterge răspunsul.");
      return;
    }
    setReviews((cur) =>
      cur.map((r) =>
        r.id === reviewId ? { ...r, reply: null } : r
      )
    );
  }

  // 👉 acum primește și reasonText (din dialogul din ReviewsSection)
  async function handleReport(reviewId, reasonText) {
    if (!reasonText || !reasonText.trim()) return;
    try {
      const res = await fetch(`/api/reviews/${reviewId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reasonText.trim() }),
      });
      if (!res.ok) {
        console.error("Failed to report review");
        alert("Nu am putut raporta recenzia.");
        return;
      }
      alert("Mulțumim! Am înregistrat raportarea.");
    } catch (e) {
      console.error(e);
      alert("Nu am putut raporta recenzia.");
    }
  }

  if (loading && !reviews.length) return <p>Se încarcă recenziile...</p>;

  return (
    <ReviewsSection
      rating={rating}
      reviews={reviews}
      totalCount={total}
      stats={stats}
      canWrite={false} // vendorul nu scrie recenzii aici
      isVendorView={true} // IMPORTANT: modul vendor
      me={me}
      onChangeQuery={handleChangeQuery}
      onVendorReply={handleVendorReply}
      onVendorDeleteReply={handleVendorDeleteReply}
      onReport={handleReport} // vendor poate raporta recenziile
    />
  );
}
