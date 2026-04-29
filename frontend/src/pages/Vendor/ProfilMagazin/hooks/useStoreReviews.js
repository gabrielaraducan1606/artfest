import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../lib/api";

export default function useStoreReviews({
  slug,
  storeSlug,
  rating,
  serviceId,
}) {
  const baseReviewsData = useMemo(
    () => ({
      items: [],
      total: 0,
      stats: {
        avg: rating || 0,
        c1: 0,
        c2: 0,
        c3: 0,
        c4: 0,
        c5: 0,
      },
    }),
    [rating]
  );

  const [revState, setRevState] = useState({
    items: baseReviewsData.items,
    total: baseReviewsData.total,
    stats: baseReviewsData.stats,
  });

  const [reviewsLoaded, setReviewsLoaded] = useState(false);

  const [query, setQuery] = useState({
    sort: "relevant",
    filter: {
      verified: false,
      star: 0,
      noReply: false,
      lowRatingOnly: false,
    },
    skip: 0,
    take: 20,
  });

  useEffect(() => {
    setRevState({
      items: baseReviewsData.items,
      total: baseReviewsData.total,
      stats: baseReviewsData.stats,
    });
    setReviewsLoaded(false);
  }, [baseReviewsData, serviceId, storeSlug, slug]);

  async function fetchReviews(q = query) {
    const params = new URLSearchParams();

    params.set("sort", q.sort);
    params.set("skip", String(q.skip));
    params.set("take", String(q.take));

    if (serviceId) {
      params.set("serviceId", serviceId);
    }

    if (q.filter?.verified) params.set("verified", "1");

    if (q.filter?.star >= 1 && q.filter?.star <= 5) {
      params.set("star", String(q.filter.star));
    }

    if (q.filter?.noReply) params.set("noReply", "1");
    if (q.filter?.lowRatingOnly) params.set("lowRatingOnly", "1");

    let data;

    if (serviceId) {
      data = await api(`/api/store-reviews?${params.toString()}`, {
        method: "GET",
      });
    } else {
      const effectiveSlug = storeSlug || slug;

      if (!effectiveSlug) return;

      const res = await fetch(
        `/api/public/store/${encodeURIComponent(
          effectiveSlug
        )}/reviews?${params.toString()}`
      );

      data = await res.json();
    }

    let items = [];
    let total = 0;
    let stats = {
      avg: 0,
      c1: 0,
      c2: 0,
      c3: 0,
      c4: 0,
      c5: 0,
    };

    if (Array.isArray(data)) {
      items = data;
      total = data.length;

      if (data.length) {
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let sum = 0;

        for (const r of data) {
          const s = Number(r.rating || 0);

          if (s >= 1 && s <= 5) {
            counts[s] = (counts[s] || 0) + 1;
            sum += s;
          }
        }

        stats = {
          c1: counts[1] || 0,
          c2: counts[2] || 0,
          c3: counts[3] || 0,
          c4: counts[4] || 0,
          c5: counts[5] || 0,
          avg: total ? Number((sum / total).toFixed(2)) : 0,
        };
      }
    } else if (data && typeof data === "object") {
      items = data.items || [];
      total = data.total ?? items.length;
      stats = data.stats || stats;
    }

    setRevState({ items, total, stats });
    setReviewsLoaded(true);
  }

  async function ensureReviewsLoaded() {
    if (reviewsLoaded) return;

    try {
      await fetchReviews(query);
    } catch {
      // noop
    }
  }

  function changeQueryFromUI(patch) {
    setQuery((prev) => {
      const next = {
        ...prev,
        ...patch,
        filter: {
          ...prev.filter,
          ...(patch?.filter || {}),
        },
        skip: 0,
      };

      fetchReviews(next).catch(() => {});
      return next;
    });
  }

  const onHelpful = async (reviewId) => {
    try {
      await api(`/api/store-reviews/${reviewId}/helpful`, {
        method: "POST",
      });

      fetchReviews(query).catch(() => {});
    } catch {
      alert("Nu am putut marca recenzia ca utilă.");
    }
  };

  const onReport = async (reviewId, reasonText) => {
    const reason = (reasonText || "").trim();
    if (!reason) return;

    try {
      await api(`/api/store-reviews/${reviewId}/report`, {
        method: "POST",
        body: { reason },
      });

      alert("Mulțumim! Am înregistrat raportarea.");
    } catch {
      alert("Nu am putut raporta recenzia.");
    }
  };

  const onDeleteUserReview = async (reviewId) => {
    if (!reviewId) return;

    const ok = window.confirm("Sigur vrei să ștergi această recenzie?");
    if (!ok) return;

    try {
      await api(`/api/store-reviews/${reviewId}`, {
        method: "DELETE",
      });

      fetchReviews(query).catch(() => {});
    } catch (e) {
      alert(e?.message || "Nu am putut șterge recenzia.");
    }
  };

  const onSubmitUserReview = async ({
    serviceId: passedServiceId,
    rating: r,
    comment: c,
  }) => {
    const sid = passedServiceId || serviceId;

    if (!sid) {
      alert(
        "Nu am putut identifica magazinul pentru recenzie. Reîncarcă pagina și încearcă din nou."
      );
      return;
    }

    const ratingVal = Number(r);
    const comment = (c || "").trim();

    if (!Number.isFinite(ratingVal) || ratingVal < 1 || ratingVal > 5) {
      alert("Te rog alege un rating între 1 și 5 stele.");
      return;
    }

    try {
      await api("/api/store-reviews", {
        method: "POST",
        body: {
          serviceId: sid,
          rating: ratingVal,
          comment,
        },
      });

      fetchReviews(query).catch(() => {});
    } catch (er) {
      console.error("onSubmitUserReview error", er);
      alert(er?.message || "Nu am putut trimite recenzia.");
    }
  };

  const onVendorReply = async (reviewId, text) => {
    await api(`/api/vendor/store-reviews/${reviewId}/reply`, {
      method: "POST",
      body: { text },
    });

    fetchReviews(query).catch(() => {});
  };

  const onVendorDeleteReply = async (reviewId) => {
    await api(`/api/vendor/store-reviews/${reviewId}/reply`, {
      method: "DELETE",
    });

    fetchReviews(query).catch(() => {});
  };

  return {
    revState,
    query,
    ensureReviewsLoaded,
    changeQueryFromUI,
    onHelpful,
    onReport,
    onDeleteUserReview,
    onSubmitUserReview,
    onVendorReply,
    onVendorDeleteReply,
  };
}