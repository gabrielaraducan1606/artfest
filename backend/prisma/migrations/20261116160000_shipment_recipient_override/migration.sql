-- Adresa destinatarului corectată de vendor / Admin înainte de AWB.
-- Doar o coloană NOUĂ, opțională (NULL pentru toate expedierile existente).
-- Nu modifică date existente; Order.shippingAddress și ShipmentDelivery rămân neatinse.

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN "recipientOverride" JSONB;
