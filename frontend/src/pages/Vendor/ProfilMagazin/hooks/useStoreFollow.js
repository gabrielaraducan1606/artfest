import { useEffect, useState } from "react";
import { api } from "../../../../lib/api";

export default function useStoreFollow({
  serviceId,
  vendorId,
  slug,
  sdSlug,
  me,
  navigate,
  trackCTA,
  trackMESSAGE,
}) {
  const [following, setFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    if (!serviceId) return;

    let alive = true;

    (async () => {
      try {
        const resCount = await api(
          `/api/stores/${encodeURIComponent(serviceId)}/followers-count`,
          { method: "GET" }
        );

        if (!alive || !resCount?.ok) return;

        const initialCount =
          typeof resCount.followersCount === "number"
            ? resCount.followersCount
            : 0;

        setFollowersCount(initialCount);

        if (me) {
          try {
            const resStatus = await api(
              `/api/stores/${encodeURIComponent(serviceId)}/follow`,
              { method: "GET" }
            );

            if (!alive || !resStatus?.ok) return;

            setFollowing(!!resStatus.following);

            if (typeof resStatus.followersCount === "number") {
              setFollowersCount(resStatus.followersCount);
            }
          } catch {
            setFollowing(false);
          }
        } else {
          setFollowing(false);
        }
      } catch {
        // noop
      }
    })();

    return () => {
      alive = false;
    };
  }, [serviceId, me]);

  async function toggleFollow() {
    if (!serviceId) {
      console.warn("Nu am serviceId, nu pot urmări magazinul.", {
        serviceId,
        vendorId,
        slug,
        sdSlug,
      });
      alert("Nu am găsit ID-ul magazinului.");
      return;
    }

    if (!me) {
      trackCTA?.("Follow (unauthenticated)");
      navigate(
        "/autentificare?redirect=" +
          encodeURIComponent(window.location.pathname)
      );
      return;
    }

    try {
      setFollowLoading(true);

      const method = following ? "DELETE" : "POST";
      trackCTA?.(following ? "Unfollow" : "Follow");

      const res = await api(
        `/api/stores/${encodeURIComponent(serviceId)}/follow`,
        { method }
      );

      if (!res?.ok) {
        alert("Nu am putut actualiza urmărirea magazinului.");
        return;
      }

      setFollowing(!!res.following);

      setFollowersCount((prev) => {
        if (typeof res.followersCount === "number") {
          return res.followersCount;
        }
        return prev + (following ? -1 : 1);
      });
    } catch (e) {
      console.error("toggleFollow error", e);
      alert(e?.message || "Eroare la actualizarea urmăririi.");
    } finally {
      setFollowLoading(false);
    }
  }

  async function handleContactVendor() {
    if (!vendorId && !serviceId) {
      console.warn("Nu am vendorId/serviceId pentru acest magazin:", {
        vendorId,
        serviceId,
        slug,
        sdSlug,
      });
      alert("Nu am găsit datele necesare pentru acest magazin.");
      return;
    }

    if (!me) {
      navigate(
        "/autentificare?redirect=" +
          encodeURIComponent(
            window.location.pathname + window.location.search
          )
      );
      return;
    }

    if (me.role === "VENDOR" || me.role === "ADMIN") {
      alert("Doar clienții (utilizatorii) pot trimite mesaje către vendor.");
      return;
    }

    try {
      const res = await api("/api/user-inbox/ensure-thread", {
        method: "POST",
        body: {
          vendorId: vendorId || null,
          serviceId: serviceId || null,
          storeSlug: sdSlug || slug || null,
        },
      });

      if (!res?.threadId) {
        alert("Nu am putut deschide conversația cu vendorul.");
        return;
      }

      trackMESSAGE?.("Contact vendor");
      navigate(`/cont/mesaje?thread=${encodeURIComponent(res.threadId)}`);
    } catch (e) {
      console.error("Nu am putut deschide conversația", e);
      alert("Nu am putut deschide conversația cu vendorul. Încearcă din nou.");
    }
  }

  return {
    following,
    followersCount,
    followLoading,
    toggleFollow,
    handleContactVendor,
  };
}