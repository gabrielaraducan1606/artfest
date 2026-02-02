// frontend/src/pages/Vendor/Orders/utils/csv.js

export function downloadOrdersCsv({ items, formatDate }) {
  const rows = [
    ["ID", "Data", "Client", "Telefon", "Email", "Status", "Total", "AWB", "Pickup", "Slot"],
    ...items.map((o) => [
      o.orderNumber || o.shortId || o.id,
      formatDate(o.createdAt),
      o.customerName || "",
      o.customerPhone || "",
      o.customerEmail || "",
      o.status || "",
      String(o.total || 0).replace(".", ","),
      o.awb || "",
      o.pickupDate ? new Date(o.pickupDate).toISOString().slice(0, 10) : "",
      o.pickupSlotStart && o.pickupSlotEnd
        ? `${new Date(o.pickupSlotStart).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}-${new Date(
            o.pickupSlotEnd
          ).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}`
        : "",
    ]),
  ];

  const csv = rows
    .map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `comenzi-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
