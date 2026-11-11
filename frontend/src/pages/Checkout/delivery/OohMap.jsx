// src/pages/Checkout/delivery/OohMap.jsx
//
// Harta locațiilor easybox / Sameday Point. Leaflet se încarcă doar când
// harta e afișată (import dinamic), cu marcaje vectoriale (fără imagini).
// Sursa hărții: VITE_MAP_TILE_URL (implicit OpenStreetMap - pentru trafic
// mare în producție e recomandat un furnizor de hărți cu contract).

import React, { useEffect, useRef, useState } from "react";
import styles from "./Delivery.module.css";

const TILE_URL = import.meta.env?.VITE_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION =
  import.meta.env?.VITE_MAP_TILE_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ROMANIA_CENTER = [45.9432, 24.9668];

const COLORS = { LOCKER: "#f59e0b", PUDO: "#2563eb" };

export default function OohMap({ locations, selectedId, onSelect, visible = true }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const leafletRef = useRef(null);
  const [failed, setFailed] = useState(false);
  // marcajele se desenează și când locațiile sosesc înaintea hărții
  const [ready, setReady] = useState(false);

  // inițializare o singură dată
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // build-ul ESM al Leaflet (ales de Vite) nu are export implicit
        const [mod] = await Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")]);
        const L = mod.default || mod;
        if (cancelled || !containerRef.current || mapRef.current) return;
        leafletRef.current = L;
        // fără animație de zoom: închiderea ferestrei în timpul unei animații
        // produce erori Leaflet („_leaflet_pos”) pe hărțile eliminate
        const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true, zoomAnimation: false }).setView(ROMANIA_CENTER, 6);
        L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setFailed(false);
        setReady(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      const map = mapRef.current;
      mapRef.current = null;
      if (map) {
        map.off();
        map.stop();
        map.remove();
      }
    };
  }, []);

  // marcaje + încadrare
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const points = [];
    for (const loc of locations || []) {
      if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) continue;
      const selected = loc.id === selectedId;
      const marker = L.circleMarker([loc.lat, loc.lng], {
        radius: selected ? 11 : 7,
        weight: selected ? 3 : 1.5,
        color: selected ? "#111827" : "#ffffff",
        fillColor: COLORS[loc.type] || COLORS.LOCKER,
        fillOpacity: 0.95,
      });
      marker.bindTooltip(loc.name, { direction: "top" });
      marker.on("click", () => onSelect?.(loc.id));
      marker.addTo(layer);
      if (selected) marker.bringToFront();
      points.push([loc.lat, loc.lng]);
    }
    const selected = (locations || []).find((l) => l.id === selectedId && Number.isFinite(l.lat));
    if (selected) map.setView([selected.lat, selected.lng], Math.max(map.getZoom(), 15), { animate: false });
    else if (points.length) map.fitBounds(points, { padding: [24, 24], maxZoom: 15, animate: false });
  }, [locations, selectedId, onSelect, ready]);

  // harta ascunsă pe mobil (tab-ul „Listă”) -> recalcul la afișare
  useEffect(() => {
    if (visible && mapRef.current) setTimeout(() => mapRef.current?.invalidateSize({ animate: false }), 50);
  }, [visible]);

  if (failed) {
    return <div className={styles.mapFallback}>Harta nu poate fi afișată acum. Poți alege locația din listă.</div>;
  }
  return <div ref={containerRef} className={styles.map} role="region" aria-label="Harta locațiilor" />;
}
