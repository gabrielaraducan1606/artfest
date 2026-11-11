-- Retur STANDARD: adresa de ridicare confirmată de client (snapshot JSON validat în
-- nomenclatorul Sameday), copiată în ShipmentDelivery la crearea Shipment-ului RETURN.
-- Strict aditivă: o coloană opțională, fără valoare implicită -> cererile existente rămân null.

-- AlterTable
ALTER TABLE "ReturnRequest" ADD COLUMN     "pickupAddress" JSONB;
