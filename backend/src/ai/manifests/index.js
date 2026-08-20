// src/ai/manifests/index.js

import {
  CATALOG_IMPORTS_MANIFEST,
} from "./catalogImports.manifest.js";

import {
  CATALOG_PRODUCTS_MANIFEST,
} from "./catalogProducts.manifest.js";

import {
  VENDOR_CAMPAIGNS_MANIFEST,
} from "./vendorCampaigns.manifest.js";
/*
 * Aici adăugăm manifestele noi ale platformei.
 *
 * Exemple viitoare:
 *
 * import {
 *   CAMPAIGNS_MANIFEST,
 * } from "./campaigns.manifest.js";
 *
 * import {
 *   ORDERS_MANIFEST,
 * } from "./orders.manifest.js";
 */
const PLATFORM_MANIFESTS = [
  CATALOG_IMPORTS_MANIFEST,
  CATALOG_PRODUCTS_MANIFEST,
  VENDOR_CAMPAIGNS_MANIFEST,
];

export function getPlatformManifests() {
  return PLATFORM_MANIFESTS;
}

export function getPlatformManifestForAI() {
  return PLATFORM_MANIFESTS.map(
    (manifest) => {
      const endpoints = {};

      for (
        const [
          key,
          endpoint,
        ] of Object.entries(
          manifest.endpoints ||
            {}
        )
      ) {
        const basePath =
          String(
            manifest.basePath ||
              ""
          ).replace(
            /\/+$/,
            ""
          );

        const relativePath =
          endpoint.path === "/"
            ? ""
            : endpoint.path;

        endpoints[key] = {
          ...endpoint,

          fullPath:
            `${basePath}${relativePath}`,
        };
      }

      return {
        ...manifest,
        endpoints,
      };
    }
  );
}