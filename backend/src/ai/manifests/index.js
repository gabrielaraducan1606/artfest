// src/ai/manifests/index.js

/*
 * Registru central al manifestelor platformei. Schema comună
 * (toate manifestele noi o urmează; cele 3 mai vechi au fost
 * extinse aditiv, fără să le schimb basePath/endpoints/features -
 * acelea alimentează direct înregistrarea rutelor reale, vezi
 * getCatalogImportRoute/getCatalogProductsRoute/getVendorCampaignRoute):
 *
 * {
 *   id, title, audience, available, status,
 *   description, tags, aliases, uiLocations,
 *   capabilities, limitations, flows, integrations,
 *   endpoints, faq, unavailableFeatures, notes
 * }
 *
 * status: "ACTIVE" | "PARTIAL" | "PLANNED" | "DISABLED" | "INTERNAL"
 *
 * getPlatformManifestForAI() rămâne pentru compatibilitate (folosit
 * de vendorPlatformKnowledge.js) - dumpul complet, fără retrieval.
 * Noul knowledgeRetrieval.js (FAZA 3) NU trimite toate manifestele
 * la LLM - selectează doar cele relevante din getPlatformManifests().
 */

import {
  CATALOG_IMPORTS_MANIFEST,
} from "./catalogImports.manifest.js";

import {
  CATALOG_PRODUCTS_MANIFEST,
} from "./catalogProducts.manifest.js";

import {
  VENDOR_CAMPAIGNS_MANIFEST,
} from "./vendorCampaigns.manifest.js";

import { AUTH_MANIFEST } from "./auth.manifest.js";
import { USER_PROFILE_MANIFEST } from "./userProfile.manifest.js";
import { VENDOR_STORE_PROFILE_MANIFEST } from "./vendorStoreProfile.manifest.js";
import { PRODUCTS_MANIFEST } from "./products.manifest.js";
import { ORDERS_MANIFEST } from "./orders.manifest.js";
import { CHECKOUT_PAYMENTS_MANIFEST } from "./checkoutPayments.manifest.js";
import { SHIPPING_AWB_MANIFEST } from "./shippingAwb.manifest.js";
import { QUOTES_MANIFEST } from "./quotes.manifest.js";
import { MESSAGES_MANIFEST } from "./messages.manifest.js";
import { NOTIFICATIONS_MANIFEST } from "./notifications.manifest.js";
import { REVIEWS_MANIFEST } from "./reviews.manifest.js";
import { WISHLIST_MANIFEST } from "./wishlist.manifest.js";
import { INVOICES_MANIFEST } from "./invoices.manifest.js";
import { SUPPORT_MANIFEST } from "./support.manifest.js";
import { COSTS_PROFIT_MANIFEST } from "./costsProfit.manifest.js";
import { SUBSCRIPTIONS_PLANS_MANIFEST } from "./subscriptionsPlans.manifest.js";
import { LEGAL_PRIVACY_MANIFEST } from "./legalPrivacy.manifest.js";
import { INFLUENCER_MANIFEST } from "./influencer.manifest.js";
import { HOMEPAGE_FEATURES_MANIFEST } from "./homepageFeatures.manifest.js";
import { RETURNS_MANIFEST } from "./returns.manifest.js";
import { SEO_VISIBILITY_MANIFEST } from "./seoVisibility.manifest.js";
import { COLLECTIONS_MANIFEST } from "./collections.manifest.js";
import { AMBASSADOR_VENDOR_PROGRAM_MANIFEST } from "./ambassadorVendorProgram.manifest.js";
import { PLATFORM_OVERVIEW_MANIFEST } from "./platformOverview.manifest.js";

/*
 * Domenii verificate direct din cod și adăugate ulterior (2026-08-24):
 * homepage-features (produsul zilei/artizanul săptămânii + răspuns
 * discount vendor - acesta e și conținutul real al paginii vendor
 * "Promovări"), returns (PARTIAL - creare self-service neconfirmată
 * în backend), seo-visibility (sitemap/Google Shopping/Meta feed -
 * complet automate), collections (PARTIAL - curatoriat exclusiv
 * admin, fără flow vendor), ambassador-vendor-program (referral
 * auto-generat pentru vendori, distinct de manifestul influencer).
 * Newsletter/waitlist nu au manifest - verificate în cod și
 * confirmate ca fiind exclusiv capturare de marketing, fără
 * legătură cu contul de user/vendor.
 */
const PLATFORM_MANIFESTS = [
  PLATFORM_OVERVIEW_MANIFEST,
  CATALOG_IMPORTS_MANIFEST,
  CATALOG_PRODUCTS_MANIFEST,
  VENDOR_CAMPAIGNS_MANIFEST,
  AUTH_MANIFEST,
  USER_PROFILE_MANIFEST,
  VENDOR_STORE_PROFILE_MANIFEST,
  PRODUCTS_MANIFEST,
  ORDERS_MANIFEST,
  CHECKOUT_PAYMENTS_MANIFEST,
  SHIPPING_AWB_MANIFEST,
  QUOTES_MANIFEST,
  MESSAGES_MANIFEST,
  NOTIFICATIONS_MANIFEST,
  REVIEWS_MANIFEST,
  WISHLIST_MANIFEST,
  INVOICES_MANIFEST,
  SUPPORT_MANIFEST,
  COSTS_PROFIT_MANIFEST,
  SUBSCRIPTIONS_PLANS_MANIFEST,
  LEGAL_PRIVACY_MANIFEST,
  INFLUENCER_MANIFEST,
  HOMEPAGE_FEATURES_MANIFEST,
  RETURNS_MANIFEST,
  SEO_VISIBILITY_MANIFEST,
  COLLECTIONS_MANIFEST,
  AMBASSADOR_VENDOR_PROGRAM_MANIFEST,
];

export function getPlatformManifests() {
  return PLATFORM_MANIFESTS;
}

/*
 * Dump complet (toate manifestele, endpoints cu fullPath calculat
 * DOAR pentru cele care au basePath+endpoints obiect - manifestele
 * noi, generice, pot avea endpoints ca obiect fără basePath, caz
 * în care fullPath rămâne null și se afișează path-ul brut).
 * Păstrat pentru compatibilitate cu vendorPlatformKnowledge.js -
 * NU e calea prin care trece copilotRouter.js (acela folosește
 * knowledgeRetrieval.js, care selectează doar manifestele
 * relevante, vezi header-ul acestui fișier).
 */
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
        const basePath = manifest.basePath
          ? String(manifest.basePath).replace(/\/+$/, "")
          : "";

        const relativePath =
          !manifest.basePath || endpoint.path === "/"
            ? endpoint.path === "/"
              ? ""
              : endpoint.path
            : endpoint.path;

        endpoints[key] = {
          ...endpoint,

          fullPath: manifest.basePath
            ? `${basePath}${relativePath}`
            : endpoint.path,
        };
      }

      return {
        ...manifest,
        endpoints,
      };
    }
  );
}
