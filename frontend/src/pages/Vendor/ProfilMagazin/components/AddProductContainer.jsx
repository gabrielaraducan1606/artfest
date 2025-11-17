// client/src/pages/Store/ProfilMagazin/components/AddProductContainer.jsx
import React, { useCallback, useEffect, useState } from "react";
import { api } from "../../../../lib/api";
import ProductModal from "./ProductModal"; // <- ajustează path-ul dacă e în alt folder

const initialForm = {
  title: "",
  description: "",
  price: "",
  currency: "RON",
  images: [],
  category: "",
  isActive: true,
  isHidden: false,

  // handmade
  availability: "READY", // READY | MADE_TO_ORDER | PREORDER | SOLD_OUT
  leadTimeDays: "",
  readyQty: "",
  nextShipDate: "",
  acceptsCustom: false,
};

export default function AddProductContainer({
  storeSlug,          // ex. "atelier-lavanda"
  open,
  onClose,
  onCreated,          // callback(updatedProduct)
  uploadFileOverride, // opțional: înlocuiește helperul implicit de upload
}) {
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState([]);

  // load categories (detaliate)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api("/api/public/categories/detailed").catch(() => []);
        if (!alive) return;
        const cats = Array.isArray(res)
          ? res.map((x) => ({ key: x.key || x.code || x, label: x.label || x.name || x }))
          : [];
        setCategories(cats);
      } catch {
        setCategories([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  // reset la deschidere/închidere
  useEffect(() => {
    if (!open) {
      setForm(initialForm);
      setSaving(false);
    }
  }, [open]);

  // validare minimală
  const validate = useCallback(() => {
    const errs = [];
    if (!String(form.title).trim()) errs.push("Titlul este obligatoriu.");
    const priceNum = Number(form.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) errs.push("Preț invalid.");
    if (form.availability === "MADE_TO_ORDER") {
      const lt = Number(form.leadTimeDays || 0);
      if (!Number.isFinite(lt) || lt <= 0) errs.push("Timpul de execuție trebuie să fie ≥ 1 zi.");
    }
    if (form.availability === "PREORDER" && form.nextShipDate) {
      const d = new Date(form.nextShipDate);
      if (Number.isNaN(d.getTime())) errs.push("Data de expediere este invalidă.");
    }
    if (errs.length) {
      alert(errs.join("\n"));
      return false;
    }
    return true;
  }, [form]);

  // SAVE -> POST /api/vendors/store/:slug/products
  const onSave = useCallback(async (e) => {
    e?.preventDefault?.();
    if (saving || !validate()) return;

    const body = {
      title: String(form.title).trim(),
      description: form.description || "",
      price: Number(form.price || 0),
      images: Array.isArray(form.images) ? form.images.slice(0, 12) : [],
      currency: form.currency || "RON",
      category: form.category || null,
      isActive: !!form.isActive,
      isHidden: !!form.isHidden,
      availability: (form.availability || "READY").toUpperCase(),
      acceptsCustom: !!form.acceptsCustom,
    };

    if (body.availability === "MADE_TO_ORDER") {
      body.leadTimeDays = Math.max(1, Number(form.leadTimeDays || 1));
      body.readyQty = 0;
      body.nextShipDate = null;
    } else if (body.availability === "READY") {
      body.readyQty = (form.readyQty === "" || form.readyQty == null)
        ? null
        : Math.max(0, Number(form.readyQty));
      body.leadTimeDays = null;
      body.nextShipDate = null;
    } else if (body.availability === "PREORDER") {
      body.nextShipDate = form.nextShipDate ? new Date(form.nextShipDate).toISOString() : null;
      body.leadTimeDays = null;
      body.readyQty = 0;
    } else if (body.availability === "SOLD_OUT") {
      body.leadTimeDays = null;
      body.readyQty = 0;
      body.nextShipDate = null;
    }

    try {
      setSaving(true);
      const created = await api(`/api/vendors/store/${encodeURIComponent(storeSlug)}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      // emite eveniment pentru carduri (opțional, dar util)
      try {
        window.dispatchEvent(new CustomEvent("vendor:productUpdated", {
          detail: { product: created }
        }));
      } catch {""}

      onCreated?.(created);
      onClose?.();
    } catch (err) {
      alert(err?.message || "Nu am putut salva produsul.");
    } finally {
      setSaving(false);
    }
  }, [saving, validate, form, storeSlug, onCreated, onClose]);

  return (
    <ProductModal
      open={open}
      onClose={onClose}
      saving={saving}
      editingProduct={null}
      form={form}
      setForm={setForm}
      categories={categories}
      onSave={onSave}
      uploadFile={uploadFileOverride}
    />
  );
}
