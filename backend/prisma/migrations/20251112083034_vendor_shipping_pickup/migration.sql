-- Doar adăugăm noile valori în enum. Fără DEFAULT-uri, fără UPDATE-uri aici.
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'PREPARING';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'READY_FOR_PICKUP';
ALTER TYPE "ShipmentStatus" ADD VALUE IF NOT EXISTS 'PICKUP_SCHEDULED';
