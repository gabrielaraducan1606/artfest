// server/controllers/productController.js

import { prisma } from "../db.js";
import { CATEGORY_SET } from "../constants/categories.js";
import {
  COLOR_SET,
  COLORS_DETAILED,
} from "../constants/colors.js";
import { MATERIALS_DETAILED } from "../constants/materials.js";

import {
  getOwnedProductsServiceBySlug,
} from "../lib/vendorProductAccess.js";

/* =========================================================
   Scheme și normalizări
========================================================= */

function normalizeOrderMode(value) {
  const mode = String(value || "READY_TO_BUY")
    .trim()
    .toUpperCase();

  if (mode === "READY_TO_BUY") {
    return "DIRECT";
  }

  if (mode === "CUSTOMIZABLE") {
    return "OPTIONS";
  }

  if (
    ["DIRECT", "OPTIONS", "QUOTE_ONLY"].includes(mode)
  ) {
    return mode;
  }

  return null;
}

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function makeSchemaKey(label) {
  return normalizeToken(label)
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function getSchemaFields(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.fields)) {
    return value.fields;
  }

  return [];
}

function normalizeOptionImageUrl(value) {
  const url = String(value || "").trim();

  if (!url) {
    return null;
  }

  return /^https?:\/\//i.test(url) ||
    url.startsWith("/")
    ? url
    : null;
}

function normalizeOptionsSchema(value) {
  const fields = getSchemaFields(value);
  const usedFields = new Set();

  return fields
    .map((field) => {
      const label = String(
        field?.label || ""
      ).trim();

      const key = String(
        field?.key || makeSchemaKey(label)
      ).trim();

      if (
        !label ||
        !key ||
        usedFields.has(key)
      ) {
        return null;
      }

      usedFields.add(key);

      const rawOptions = Array.isArray(
        field?.options
      )
        ? field.options
        : Array.isArray(field?.values)
          ? field.values
          : [];

      const usedOptions = new Set();

      const options = rawOptions
        .map((item) => {
          if (typeof item === "string") {
            const text = item.trim();

            if (!text) {
              return null;
            }

            const dedupeKey =
              normalizeToken(text);

            if (usedOptions.has(dedupeKey)) {
              return null;
            }

            usedOptions.add(dedupeKey);

            return text;
          }

          if (
            !item ||
            typeof item !== "object"
          ) {
            return null;
          }

          const optionValue = String(
            item.value ||
              item.key ||
              item.label ||
              ""
          ).trim();

          const optionLabel = String(
            item.label ||
              item.value ||
              item.key ||
              ""
          ).trim();

          if (
            !optionValue ||
            !optionLabel
          ) {
            return null;
          }

          const dedupeKey =
            normalizeToken(optionValue);

          if (usedOptions.has(dedupeKey)) {
            return null;
          }

          usedOptions.add(dedupeKey);

          return {
            value: optionValue,
            label: optionLabel,

            colorHex: item.colorHex
              ? String(item.colorHex).slice(0, 16)
              : null,

            imageUrl:
              normalizeOptionImageUrl(
                item.imageUrl
              ),

            imageIndex:
              Number.isInteger(
                item.imageIndex
              ) &&
              item.imageIndex >= 0
                ? item.imageIndex
                : null,

            disabled: !!item.disabled,
          };
        })
        .filter(Boolean)
        .slice(0, 50);

      return {
        key,
        label,
        type: "select",
        required: field?.required !== false,
        options,

        sellerCanAddValues:
          field?.sellerCanAddValues !== false,

        source:
          field?.source === "ai"
            ? "ai"
            : "seller",
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeCustomSchema(value) {
  const fields = getSchemaFields(value);

  const allowedTypes = new Set([
    "text",
    "textarea",
    "date",
    "file",
  ]);

  const usedFields = new Set();

  return fields
    .map((field) => {
      const label = String(
        field?.label || ""
      ).trim();

      const key = String(
        field?.key || makeSchemaKey(label)
      ).trim();

      if (
        !label ||
        !key ||
        usedFields.has(key)
      ) {
        return null;
      }

      usedFields.add(key);

      const type = allowedTypes.has(
        field?.type
      )
        ? field.type
        : "text";

      return {
        key,
        label,
        type,
        required: !!field?.required,
      };
    })
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeQuoteSchema(value) {
  const fields =
    getSchemaFields(value);

  const allowedTypes =
    new Set([
      "text",
      "textarea",
      "number",
      "date",
      "file",
      "select",
    ]);

  const usedFields =
    new Set();

  return fields
    .map((field) => {
      const label =
        String(
          field?.label ||
            ""
        ).trim();

      const key =
        String(
          field?.key ||
            makeSchemaKey(
              label
            )
        ).trim();

      if (
        !label ||
        !key ||
        usedFields.has(
          key
        )
      ) {
        return null;
      }

      usedFields.add(
        key
      );

      const type =
        allowedTypes.has(
          field?.type
        )
          ? field.type
          : "text";

      const id =
        field?.id
          ? String(
              field.id
            )
              .trim()
              .slice(
                0,
                120
              )
          : null;

      const options =
        type === "select"
          ? Array.from(
              new Set(
                (
                  Array.isArray(
                    field?.options
                  )
                    ? field.options
                    : []
                )
                  .map(
                    (
                      option
                    ) =>
                      String(
                        option ||
                          ""
                      ).trim()
                  )
                  .filter(
                    Boolean
                  )
              )
            ).slice(
              0,
              50
            )
          : [];

      return {
        ...(id
          ? {
              id,
            }
          : {}),

        key,

        label,

        type,

        required:
          key ===
          "description"
            ? true
            : !!field?.required,

        ...(type ===
        "select"
          ? {
              options,
            }
          : {}),
      };
    })
    .filter(
      Boolean
    )
    .slice(
      0,
      20
    );
}

function defaultQuoteSchema() {
  return [
    {
      key: "description",
      label: "Descriere cerere",
      type: "textarea",
      required: true,
    },
    {
      key: "inspirationImages",
      label: "Poze inspirație",
      type: "file",
      required: false,
    },
  ];
}

/* =========================================================
   Normalizare câmpuri produs
========================================================= */

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) =>
            String(item || "").trim()
          )
          .filter(Boolean)
      )
    ).slice(0, 20);
  }

  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ).slice(0, 20);
  }

  return [];
}

function normalizeProductImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return Array.from(
    new Set(
      images
        .map((image) =>
          String(image || "").trim()
        )
        .filter(
          (url) =>
            /^https?:\/\//i.test(url) ||
            url.startsWith("/")
        )
    )
  ).slice(0, 12);
}

function normalizeOptionalDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

function normalizeConfidence(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.max(
    0,
    Math.min(1, parsed)
  );
}

function normalizeStringArray(
  value,
  max = 50
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) =>
          String(item || "").trim()
        )
        .filter(Boolean)
    )
  ).slice(0, max);
}

function normalizeAiJson(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }

  return null;
}

function normalizeAvailabilityPayload(
  body,
  currentProduct = null
) {
  let availability;

  if (body.availability != null) {
    availability = String(
      body.availability
    )
      .trim()
      .toUpperCase();
  } else if (currentProduct?.availability) {
    availability = String(
      currentProduct.availability
    )
      .trim()
      .toUpperCase();
  } else {
    return {
      error: "availability_required",
    };
  }

  if (
    ![
      "READY",
      "MADE_TO_ORDER",
      "PREORDER",
      "SOLD_OUT",
    ].includes(availability)
  ) {
    return {
      error: "invalid_availability",
    };
  }

  const result = {
    availability,
    leadTimeDays: null,
    readyQty: null,
    nextShipDate: null,
  };

  if (availability === "MADE_TO_ORDER") {
    const leadTime =
      body.leadTimeDays != null
        ? Number(body.leadTimeDays)
        : currentProduct?.leadTimeDays ??
          null;

    if (
      !Number.isFinite(leadTime) ||
      leadTime <= 0
    ) {
      return {
        error: "invalid_lead_time",
      };
    }

    result.leadTimeDays =
      Math.floor(leadTime);

    return {
      ok: true,
      ...result,
    };
  }

  if (availability === "READY") {
    let quantity = null;

    if (
      body.readyQty != null &&
      body.readyQty !== ""
    ) {
      quantity = Number(body.readyQty);
    } else if (currentProduct) {
      quantity =
        currentProduct.readyQty ?? null;
    }

    if (
      quantity !== null &&
      (
        !Number.isFinite(quantity) ||
        quantity < 0
      )
    ) {
      return {
        error: "invalid_ready_qty",
      };
    }

    result.readyQty =
      quantity === null
        ? null
        : Math.floor(quantity);

    return {
      ok: true,
      ...result,
    };
  }

  if (availability === "PREORDER") {
    if (body.nextShipDate != null) {
      const nextShipDate = new Date(
        body.nextShipDate
      );

      if (
        Number.isNaN(
          nextShipDate.getTime()
        )
      ) {
        return {
          error: "invalid_next_ship_date",
        };
      }

      result.nextShipDate =
        nextShipDate;
    } else if (
      currentProduct?.nextShipDate
    ) {
      result.nextShipDate =
        currentProduct.nextShipDate;
    }

    return {
      ok: true,
      ...result,
    };
  }

  result.readyQty = 0;

  return {
    ok: true,
    ...result,
  };
}

/* =========================================================
   Mapper produs
========================================================= */

function mapProduct(product) {
  return {
    id: product.id,
    title: product.title,

    description:
      product.description || "",

    price:
      Math.round(product.priceCents) /
      100,

    priceCents:
      product.priceCents,

    images:
      Array.isArray(product.images)
        ? product.images
        : [],

    currency:
      product.currency || "RON",

    isActive:
      product.isActive,

    isHidden:
      !!product.isHidden,

    category:
      product.category || null,

    color:
      product.color || null,

    availability:
      product.availability
        ? String(
            product.availability
          ).toUpperCase()
        : null,

    leadTimeDays:
      product.leadTimeDays ?? null,

    readyQty:
      product.readyQty ?? null,

    nextShipDate:
      product.nextShipDate ?? null,

    acceptsCustom:
      !!product.acceptsCustom,

    orderMode:
      product.orderMode === "DIRECT"
        ? "READY_TO_BUY"
        : product.orderMode ||
          "READY_TO_BUY",

    optionsSchema:
      getSchemaFields(
        product.optionsSchema
      ),

    customSchema:
      getSchemaFields(
        product.customSchema
      ),

    quoteSchema:
      getSchemaFields(
        product.quoteSchema
      ),

    aiVisionAnalysis:
      normalizeAiJson(
        product.aiVisionAnalysis
      ),

    aiOrderAnalysis:
      normalizeAiJson(
        product.aiOrderAnalysis
      ),

    aiGeneratedFields:
      Array.isArray(
        product.aiGeneratedFields
      )
        ? product.aiGeneratedFields
        : [],

    aiSourceImages:
      Array.isArray(
        product.aiSourceImages
      )
        ? product.aiSourceImages
        : [],

    aiAnalysisVersion:
      product.aiAnalysisVersion ||
      null,

    aiConfidence:
      product.aiConfidence ?? null,

    aiAnalyzedAt:
      product.aiAnalyzedAt || null,

    aiManuallyEdited:
      !!product.aiManuallyEdited,

    materialMain:
      product.materialMain || null,

    technique:
      product.technique || null,

    styleTags:
      Array.isArray(
        product.styleTags
      )
        ? product.styleTags
        : [],

    occasionTags:
      Array.isArray(
        product.occasionTags
      )
        ? product.occasionTags
        : [],

    dimensions:
      product.dimensions || null,

    careInstructions:
      product.careInstructions ||
      null,

    specialNotes:
      product.specialNotes || null,

    moderationStatus:
      product.moderationStatus ||
      "PENDING",

    moderationMessage:
      product.moderationMessage ||
      null,

    submittedAt:
      product.submittedAt || null,

    reviewedAt:
      product.reviewedAt || null,

    reviewedByUserId:
      product.reviewedByUserId ||
      null,

    approvedAt:
      product.approvedAt || null,

    createdAt:
      product.createdAt,

    updatedAt:
      product.updatedAt,
  };
}

/* =========================================================
   Filtrare și sortare
========================================================= */

function parseBooleanQuery(value) {
  if (value === undefined) {
    return undefined;
  }

  const normalized = String(value)
    .trim()
    .toLowerCase();

  if (
    normalized === "true" ||
    normalized === "1"
  ) {
    return true;
  }

  if (
    normalized === "false" ||
    normalized === "0"
  ) {
    return false;
  }

  return undefined;
}

function buildProductOrderBy(
  sort = "new"
) {
  switch (String(sort || "new")) {
    case "price_asc":
      return [
        { priceCents: "asc" },
        { createdAt: "desc" },
      ];

    case "price_desc":
      return [
        { priceCents: "desc" },
        { createdAt: "desc" },
      ];

    case "old":
      return [
        { createdAt: "asc" },
      ];

    case "title_asc":
      return [
        { title: "asc" },
      ];

    case "title_desc":
      return [
        { title: "desc" },
      ];

    case "new":
    default:
      return [
        { createdAt: "desc" },
      ];
  }
}

function applyProductFilters(
  where,
  query = {}
) {
  const {
    q = "",
    category = "",
    availability = "",
    isActive,
    isHidden,
    moderationStatus = "",
  } = query;

  if (category) {
    where.category =
      String(category).trim();
  }

  const normalizedAvailability =
    String(availability || "")
      .trim()
      .toUpperCase();

  if (normalizedAvailability) {
    where.availability =
      normalizedAvailability;
  }

  const normalizedModeration =
    String(moderationStatus || "")
      .trim()
      .toUpperCase();

  if (
    [
      "PENDING",
      "APPROVED",
      "REJECTED",
      "CHANGES_REQUESTED",
    ].includes(normalizedModeration)
  ) {
    where.moderationStatus =
      normalizedModeration;
  }

  const active = parseBooleanQuery(
    isActive
  );

  if (active !== undefined) {
    where.isActive = active;
  }

  const hidden = parseBooleanQuery(
    isHidden
  );

  if (hidden !== undefined) {
    where.isHidden = hidden;
  }

  const search = String(q || "").trim();

  if (search) {
    where.OR = [
      {
        title: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        description: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        category: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        color: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        materialMain: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        technique: {
          contains: search,
          mode: "insensitive",
        },
      },
      {
        styleTags: {
          has: search,
        },
      },
      {
        occasionTags: {
          has: search,
        },
      },
    ];
  }
}

/* =========================================================
   Plan și limite
========================================================= */

async function getActivePlanForVendor(
  vendorId
) {
  const now = new Date();

  const subscription =
    await prisma.vendorSubscription.findFirst({
      where: {
        vendorId,

        OR: [
          {
            status: "active",
            endAt: {
              gt: now,
            },
          },
          {
            trialEndsAt: {
              gt: now,
            },
          },
        ],
      },

      include: {
        plan: true,
      },

      orderBy: [
        {
          startAt: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
    });

  if (subscription?.plan) {
    return subscription.plan;
  }

  const basicPlan =
    await prisma.subscriptionPlan.findUnique({
      where: {
        code: "basic",
      },
    });

  return (
    basicPlan ?? {
      code: "basic",
      name: "Basic",
      maxProducts: 25,
      commissionBps: 1200,
    }
  );
}

async function resolveProductLimitForVendor({
  vendorId,
}) {
  const [plan, vendor] =
    await Promise.all([
      getActivePlanForVendor(
        vendorId
      ),

      prisma.vendor.findUnique({
        where: {
          id: vendorId,
        },

        select: {
          productLimitOverride: true,
        },
      }),
    ]);

  let limit;

  if (
    vendor?.productLimitOverride ===
    -1
  ) {
    limit = null;
  } else if (
    typeof vendor?.productLimitOverride ===
    "number"
  ) {
    limit =
      vendor.productLimitOverride;
  } else {
    limit =
      plan?.maxProducts ?? null;
  }

  return {
    plan,
    limit,
    override:
      vendor?.productLimitOverride ??
      null,
  };
}

async function checkProductLimitForService({
  serviceId,
  vendorId,
}) {
  const {
    plan,
    limit,
    override,
  } =
    await resolveProductLimitForVendor({
      vendorId,
    });

  const current =
    await prisma.product.count({
      where: {
        serviceId,
      },
    });

  if (limit == null) {
    return {
      ok: true,

      plan: {
        code: plan.code,
        name: plan.name,
      },

      limit: null,
      current,
      override,
    };
  }

  if (current >= limit) {
    return {
      ok: false,
      error: "upgrade_required",
      reason:
        "products_limit_reached",

      plan: {
        code: plan.code,
        name: plan.name,
      },

      limit,
      current,
      override,
    };
  }

  return {
    ok: true,

    plan: {
      code: plan.code,
      name: plan.name,
    },

    limit,
    current,
    override,
  };
}

/* =========================================================
   Preseturi
========================================================= */

export function getOptionPresets(
  _req,
  res
) {
  return res.json({
    colors: COLORS_DETAILED.map(
      (item) =>
        item.label ||
        item.name ||
        item.key ||
        item.value
    ).filter(Boolean),

    materials:
      MATERIALS_DETAILED.map(
        (item) =>
          item.label ||
          item.name ||
          item.key ||
          item.value
      ).filter(Boolean),

    scents: [
      "Lavandă",
      "Vanilie",
      "Cocos",
      "Trandafir",
      "Scorțișoară",
      "Citrice",
      "Miere",
      "Cafea",
      "Ciocolată",
      "Mentă",
    ],
  });
}

/* =========================================================
   Listare publică magazin
========================================================= */

export async function publicListProducts(
  req,
  res
) {
  try {
    const slug = String(
      req.params.slug || ""
    )
      .trim()
      .toLowerCase();

    const profile =
      await prisma.serviceProfile.findUnique({
        where: {
          slug,
        },

        include: {
          service: {
            include: {
              type: true,
            },
          },
        },
      });

    if (
      !profile ||
      profile.service?.type?.code !==
        "products"
    ) {
      return res.status(404).json({
        error: "not_found",
      });
    }

    const {
      q = "",
      category = "",
      availability = "",
      pmin = "",
      pmax = "",
      color = "",
      sort = "new",
      cursor,
      take = "24",
    } = req.query || {};

    const where = {
      serviceId:
        profile.serviceId,

      isActive: true,
      isHidden: false,

      moderationStatus:
        "APPROVED",
    };

    if (category) {
      where.category =
        String(category).trim();
    }

    if (color) {
      where.color =
        String(color).trim();
    }
const normalizedAvailability =
  String(availability || "")
    .trim()
    .toUpperCase();

if (
  normalizedAvailability ===
  "READY"
) {
  where.availability =
    "READY";
} else if (
  normalizedAvailability ===
  "SOLD_OUT"
) {
  where.availability =
    "SOLD_OUT";
} else if (
  [
    "MADE_TO_ORDER",
    "PREORDER",
  ].includes(
    normalizedAvailability
  )
) {
  where.availability =
    normalizedAvailability;
}

    const minPrice =
      Number(pmin);

    const maxPrice =
      Number(pmax);

    if (
      Number.isFinite(minPrice) ||
      Number.isFinite(maxPrice)
    ) {
      where.priceCents = {};

      if (
        Number.isFinite(minPrice)
      ) {
        where.priceCents.gte =
          Math.round(
            minPrice * 100
          );
      }

      if (
        Number.isFinite(maxPrice)
      ) {
        where.priceCents.lte =
          Math.round(
            maxPrice * 100
          );
      }
    }

    const search =
      String(q || "").trim();

    if (search) {
      where.OR = (
        where.OR || []
      ).concat([
        {
          title: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          description: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          category: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          color: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          styleTags: {
            has: search,
          },
        },
        {
          occasionTags: {
            has: search,
          },
        },
      ]);
    }

    const pageSize = Math.max(
      1,
      Math.min(
        48,
        Number(take) || 24
      )
    );

    const cursorObject = cursor
      ? {
          id: String(cursor),
        }
      : undefined;

    const products =
      await prisma.product.findMany({
        where,

        orderBy:
          buildProductOrderBy(sort),

        take: pageSize + 1,

        ...(cursorObject
          ? {
              cursor:
                cursorObject,

              skip: 1,
            }
          : {}),
      });

    const hasMore =
      products.length > pageSize;

    const items = hasMore
      ? products.slice(
          0,
          pageSize
        )
      : products;

    res.set(
      "Cache-Control",
      "public, max-age=0, must-revalidate"
    );

    return res.json({
      items:
        items.map(mapProduct),

      nextCursor:
        hasMore && items.length
          ? items[
              items.length - 1
            ].id
          : null,
    });
  } catch (error) {
    console.error(
      "GET /public/store/:slug/products error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

export async function getPublicProduct(
  req,
  res
) {
  try {
    const id = String(
      req.params.id || ""
    ).trim();

    if (!id) {
      return res.status(400).json({
        error: "invalid_product_id",
      });
    }

    const product =
      await prisma.product.findFirst({
        where: {
          id,
          isActive: true,
          isHidden: false,
          moderationStatus: "APPROVED",
        },

        include: {
          service: {
            include: {
              type: true,

              vendor: {
                select: {
                  id: true,
                  userId: true,
                  displayName: true,
                  city: true,
                },
              },

              profile: {
                select: {
                  slug: true,
                  displayName: true,
                  city: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });

    if (!product) {
      return res.status(404).json({
        error: "not_found",
      });
    }

    if (
      product.service?.type?.code !==
      "products"
    ) {
      return res.status(404).json({
        error: "not_found",
      });
    }

    return res.json({
      ...mapProduct(product),

      ownerVendorId:
        product.service.vendorId,

      vendor: {
        id:
          product.service.vendor?.id ||
          null,

        userId:
          product.service.vendor
            ?.userId || null,

        displayName:
          product.service.profile
            ?.displayName ||
          product.service.vendor
            ?.displayName ||
          "",

        slug:
          product.service.profile
            ?.slug || null,

        city:
          product.service.profile
            ?.city ||
          product.service.vendor
            ?.city ||
          "",

        avatarUrl:
          product.service.profile
            ?.avatarUrl || null,
      },

      service: {
        id:
          product.service.id,

        vendorId:
          product.service.vendorId,

        isActive:
          !!product.service.isActive,

        status:
          product.service.status,

        profile: {
          slug:
            product.service.profile
              ?.slug || null,

          displayName:
            product.service.profile
              ?.displayName || "",

          city:
            product.service.profile
              ?.city || "",

          avatarUrl:
            product.service.profile
              ?.avatarUrl || null,
        },

        vendor: {
          id:
            product.service.vendor
              ?.id || null,

          userId:
            product.service.vendor
              ?.userId || null,
        },
      },
    });
  } catch (error) {
    console.error(
      "GET /public/products/:id error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

/* =========================================================
   Listare produse vendor
========================================================= */

export async function listVendorProducts(
  req,
  res
) {
  try {
    const slug = String(
      req.params.slug || ""
    )
      .trim()
      .toLowerCase();

    const {
      service,
      error,
      status,
    } =
      await getOwnedProductsServiceBySlug(
        slug,
        req.user.sub
      );

    if (error) {
      return res
        .status(status)
        .json({ error });
    }

    const {
      sort = "new",
      take = "100",
    } = req.query || {};

    const where = {
      serviceId: service.id,
    };

    applyProductFilters(
      where,
      req.query
    );

    const pageSize = Math.max(
      1,
      Math.min(
        200,
        Number(take) || 100
      )
    );

    const products =
      await prisma.product.findMany({
        where,

        orderBy:
          buildProductOrderBy(sort),

        take: pageSize,
      });

    return res.json({
      store: {
        id: service.id,
        vendorId:
          service.vendorId,
        slug,
        status:
          service.status,
        isActive:
          !!service.isActive,
      },

      items:
        products.map(mapProduct),

      total:
        products.length,
    });
  } catch (error) {
    console.error(
      "GET /vendors/store/:slug/products error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

/* =========================================================
   Detalii produs vendor
========================================================= */

export async function getVendorProduct(
  req,
  res
) {
  try {
    const id = String(
      req.params.id || ""
    );

    const product =
      await prisma.product.findUnique({
        where: {
          id,
        },

        include: {
          service: {
            include: {
              vendor: true,
              type: true,
              profile: true,
            },
          },
        },
      });

    if (!product) {
      return res.status(404).json({
        error: "not_found",
      });
    }

    if (
      product.service?.vendor
        ?.userId !== req.user.sub
    ) {
      return res.status(403).json({
        error: "forbidden",
      });
    }

    if (
      product.service?.type
        ?.code !== "products"
    ) {
      return res.status(400).json({
        error:
          "not_a_products_store",
      });
    }

    return res.json({
      ...mapProduct(product),

      ownerVendorId:
        product.service.vendorId,

      vendor: {
        id:
          product.service.vendor.id,

        displayName:
          product.service.profile
            ?.displayName ||
          product.service.vendor
            .displayName ||
          "",

        slug:
          product.service.profile
            ?.slug || null,

        city:
          product.service.profile
            ?.city ||
          product.service.vendor
            .city ||
          "",
      },

      service: {
        id:
          product.service.id,

        status:
          product.service.status,

        isActive:
          !!product.service
            .isActive,
      },
    });
  } catch (error) {
    console.error(
      "GET /vendors/products/:id error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

/* =========================================================
   Limite produse
========================================================= */

export async function getProductLimits(
  req,
  res
) {
  try {
    const slug = String(
      req.params.slug || ""
    )
      .trim()
      .toLowerCase();

    const {
      service,
      error,
      status,
    } =
      await getOwnedProductsServiceBySlug(
        slug,
        req.user.sub
      );

    if (error) {
      return res
        .status(status)
        .json({ error });
    }

    const result =
      await checkProductLimitForService({
        serviceId:
          service.id,

        vendorId:
          service.vendorId,
      });

    return res.json({
      plan: result.plan,

      maxProducts:
        result.limit,

      currentProducts:
        result.current,

      canAdd:
        result.ok,

      override:
        result.override,
    });
  } catch (error) {
    console.error(
      "GET /vendors/store/:slug/products/limits error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

/* =========================================================
   Pricing și comision
========================================================= */

export async function getProductPricing(
  req,
  res
) {
  try {
    const slug = String(
      req.params.slug || ""
    )
      .trim()
      .toLowerCase();

    const {
      service,
      error,
      status,
    } =
      await getOwnedProductsServiceBySlug(
        slug,
        req.user.sub
      );

    if (error) {
      return res
        .status(status)
        .json({ error });
    }

    const plan =
      await getActivePlanForVendor(
        service.vendorId
      );

    const commissionBps =
      plan?.commissionBps != null
        ? Number(
            plan.commissionBps
          )
        : 0;

    return res.json({
      plan: {
        code:
          plan?.code || "basic",

        name:
          plan?.name || "Basic",
      },

      commissionBps:
        Number.isFinite(
          commissionBps
        )
          ? commissionBps
          : 0,
    });
  } catch (error) {
    console.error(
      "GET /vendors/store/:slug/products/pricing error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

/* =========================================================
   Sugestie preț
========================================================= */

function normalizeComparisonText(value) {
  return normalizeToken(value);
}

function parseDimensionScore(
  dimensions = ""
) {
  const values = String(
    dimensions || ""
  )
    .match(/\d+([.,]\d+)?/g)
    ?.map((value) =>
      Number(
        String(value).replace(
          ",",
          "."
        )
      )
    )
    .filter(
      (value) =>
        Number.isFinite(value) &&
        value > 0
    );

  if (!values?.length) {
    return null;
  }

  return values.reduce(
    (total, value) =>
      total * value,
    1
  );
}

function similarityScore(
  product,
  target
) {
  let score = 0;

  if (
    product.category ===
    target.category
  ) {
    score += 50;
  }

  const productMaterial =
    normalizeComparisonText(
      product.materialMain
    );

  const targetMaterial =
    normalizeComparisonText(
      target.materialMain
    );

  if (
    productMaterial &&
    targetMaterial &&
    (
      productMaterial.includes(
        targetMaterial
      ) ||
      targetMaterial.includes(
        productMaterial
      )
    )
  ) {
    score += 15;
  }

  const productTechnique =
    normalizeComparisonText(
      product.technique
    );

  const targetTechnique =
    normalizeComparisonText(
      target.technique
    );

  if (
    productTechnique &&
    targetTechnique &&
    (
      productTechnique.includes(
        targetTechnique
      ) ||
      targetTechnique.includes(
        productTechnique
      )
    )
  ) {
    score += 10;
  }

  const productDimensions =
    parseDimensionScore(
      product.dimensions
    );

  const targetDimensions =
    parseDimensionScore(
      target.dimensions
    );

  if (
    productDimensions &&
    targetDimensions
  ) {
    const ratio =
      Math.min(
        productDimensions,
        targetDimensions
      ) /
      Math.max(
        productDimensions,
        targetDimensions
      );

    if (ratio > 0.75) {
      score += 20;
    } else if (ratio > 0.5) {
      score += 12;
    } else if (ratio > 0.3) {
      score += 6;
    }
  }

  return score;
}

function calculateMedian(values) {
  if (!values.length) {
    return 0;
  }

  const sorted = [
    ...values,
  ].sort(
    (first, second) =>
      first - second
  );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  return sorted.length % 2 === 0
    ? Math.round(
        (
          sorted[middle - 1] +
          sorted[middle]
        ) / 2
      )
    : sorted[middle];
}

export async function suggestProductPrice(
  req,
  res
) {
  try {
    const slug = String(
      req.params.slug || ""
    )
      .trim()
      .toLowerCase();

    const {
      error,
      status,
    } =
      await getOwnedProductsServiceBySlug(
        slug,
        req.user.sub
      );

    if (error) {
      return res
        .status(status)
        .json({ error });
    }

    const {
      category,
      materialMain = "",
      technique = "",
      dimensions = "",
    } = req.body || {};

    if (!category) {
      return res.status(400).json({
        error:
          "category_required",

        message:
          "Alege o categorie înainte de recomandarea de preț.",
      });
    }

    const products =
      await prisma.product.findMany({
        where: {
          category:
            String(category),

          priceCents: {
            gt: 0,
          },

          moderationStatus:
            "APPROVED",
        },

        select: {
          priceCents: true,
          category: true,
          materialMain: true,
          technique: true,
          dimensions: true,
          title: true,
        },

        take: 120,

        orderBy: {
          createdAt: "desc",
        },
      });

    if (!products.length) {
      return res.json({
        ok: true,
        hasEnoughData: false,
        confidence: "low",
        shouldWarn: false,

        message:
          "Nu avem încă suficiente produse similare pentru o recomandare sigură.",
      });
    }

    const target = {
      category:
        String(category),

      materialMain,
      technique,
      dimensions,
    };

    const scored = products
      .map((product) => ({
        ...product,

        score:
          similarityScore(
            product,
            target
          ),

        price:
          Math.round(
            product.priceCents /
              100
          ),
      }))
      .filter(
        (product) =>
          product.score >= 50
      )
      .sort(
        (first, second) =>
          second.score -
          first.score
      )
      .slice(0, 40);

    const used =
      scored.length >= 3
        ? scored
        : products.map(
            (product) => ({
              ...product,

              score: 50,

              price:
                Math.round(
                  product.priceCents /
                    100
                ),
            })
          );

    const prices = used
      .map(
        (product) =>
          product.price
      )
      .filter(
        (price) =>
          Number.isFinite(price) &&
          price > 0
      );

    if (!prices.length) {
      return res.json({
        ok: true,
        hasEnoughData: false,
        confidence: "low",
        shouldWarn: false,

        message:
          "Nu avem suficiente prețuri valide pentru recomandare.",
      });
    }

    const minimum =
      Math.min(...prices);

    const maximum =
      Math.max(...prices);

    const average =
      Math.round(
        prices.reduce(
          (total, price) =>
            total + price,
          0
        ) / prices.length
      );

    const median =
      calculateMedian(prices);

    const recommendedMin =
      Math.max(
        1,
        Math.round(
          median * 0.85
        )
      );

    const recommendedMax =
      Math.round(
        median * 1.25
      );

    const confidence =
      scored.length >= 8
        ? "high"
        : scored.length >= 3
          ? "medium"
          : "low";

    return res.json({
      ok: true,

      hasEnoughData:
        used.length >= 3,

      confidence,

      basedOn:
        used.length,

      shouldWarn:
        confidence !== "low",

      platformStats: {
        min: minimum,
        max: maximum,
        avg: average,
        median,
      },

      recommendation: {
        min: recommendedMin,
        max: recommendedMax,
        competitive: median,
        premium:
          Math.round(
            median * 1.2
          ),
      },

      warningRules: {
        tooLowBelow:
          Math.round(
            recommendedMin *
              0.75
          ),

        tooHighAbove:
          Math.round(
            recommendedMax *
              1.4
          ),
      },

      message:
        confidence === "low"
          ? "Recomandarea este orientativă, pentru că nu avem destule produse foarte similare."
          : `Preț recomandat: ${recommendedMin} - ${recommendedMax} RON, bazat pe ${used.length} produse similare.`,
    });
  } catch (error) {
    console.error(
      "POST /vendors/store/:slug/products/price-suggestion error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

/* =========================================================
   Creare produs
========================================================= */

export async function createProduct(
  req,
  res
) {
  try {
    const slug = String(
      req.params.slug || ""
    )
      .trim()
      .toLowerCase();

    const {
      service,
      error,
      status,
    } =
      await getOwnedProductsServiceBySlug(
        slug,
        req.user.sub
      );

    if (error) {
      return res
        .status(status)
        .json({ error });
    }

    const limitCheck =
      await checkProductLimitForService({
        serviceId:
          service.id,

        vendorId:
          service.vendorId,
      });

    if (!limitCheck.ok) {
      return res.status(402).json({
        ...limitCheck,

        title:
          "Ai atins limita de produse",

        message:
          limitCheck.limit == null
            ? "Nu mai poți adăuga produse pe planul curent."
            : `Planul tău permite maximum ${limitCheck.limit} produse. Ai deja ${limitCheck.current}. Pentru a adăuga mai multe produse, modifică abonamentul.`,

        cta: {
          label:
            "Modifică abonamentul",

          url:
            "/setari?tab=subscription",
        },
      });
    }

    const {
      title,
      description = "",
      price,
      images = [],
      currency = "RON",
      category = null,
      color = null,

      availability,
      leadTimeDays,
      readyQty,
      nextShipDate,

      acceptsCustom = false,

      orderMode =
        "READY_TO_BUY",

      optionsSchema = [],
      customSchema = [],
      quoteSchema = [],

      aiVisionAnalysis = null,
      aiOrderAnalysis = null,
      aiGeneratedFields = [],
      aiSourceImages = [],
      aiAnalysisVersion = null,
      aiConfidence = null,
      aiAnalyzedAt = null,
      aiManuallyEdited = false,

      materialMain,
      technique,
      styleTags,
      occasionTags,
      dimensions,
      careInstructions,
      specialNotes,
    } = req.body || {};

    const normalizedOrderMode =
      normalizeOrderMode(
        orderMode
      );

    if (!normalizedOrderMode) {
      return res.status(400).json({
        error:
          "invalid_order_mode",
      });
    }

    if (
      typeof title !== "string" ||
      !title.trim()
    ) {
      return res.status(400).json({
        error: "invalid_title",
      });
    }

    const numericPrice =
      Number(price);

    if (
      normalizedOrderMode !==
        "QUOTE_ONLY" &&
      (
        !Number.isFinite(
          numericPrice
        ) ||
        numericPrice <= 0
      )
    ) {
      return res.status(400).json({
        error: "invalid_price",
      });
    }

    const priceCents =
      normalizedOrderMode ===
      "QUOTE_ONLY"
        ? 0
        : Math.round(
            numericPrice * 100
          );

    const normalizedImages =
      normalizeProductImages(
        images
      );

    if (!normalizedImages.length) {
      return res.status(400).json({
        error:
          "product_image_required",

        message:
          "Adaugă cel puțin o imagine validă.",
      });
    }

    let normalizedCategory = null;

    if (
      category != null &&
      String(category).trim()
    ) {
      const value =
        String(category).trim();

      if (!CATEGORY_SET.has(value)) {
        return res.status(400).json({
          error:
            "invalid_category",
        });
      }

      normalizedCategory = value;
    }

    let normalizedColor = null;

    if (
      color != null &&
      String(color).trim()
    ) {
      const value =
        String(color).trim();

      if (!COLOR_SET.has(value)) {
        return res.status(400).json({
          error: "invalid_color",
        });
      }

      normalizedColor = value;
    }

    const availabilityResult =
      normalizeAvailabilityPayload(
        {
          availability,
          leadTimeDays,
          readyQty,
          nextShipDate,
        }
      );

    if (
      availabilityResult.error
    ) {
      return res.status(400).json({
        error:
          availabilityResult.error,
      });
    }

 if (
  normalizedOrderMode ===
    "DIRECT" &&
  ![
    "READY",
    "MADE_TO_ORDER",
    "PREORDER",
    "SOLD_OUT",
  ].includes(
    availabilityResult.availability
  )
){
      return res.status(400).json({
        error:
          "invalid_direct_availability",

        message:
          "Produsele care se cumpără direct trebuie să fie disponibile din stoc sau marcate ca epuizate.",
      });
    }

    const normalizedOptions =
      normalizeOptionsSchema(
        optionsSchema
      );

    const normalizedCustom =
      normalizeCustomSchema(
        customSchema
      );

    const normalizedQuote =
      normalizeQuoteSchema(
        getSchemaFields(
          quoteSchema
        ).length
          ? quoteSchema
          : defaultQuoteSchema()
      );

    if (
      normalizedOrderMode ===
        "OPTIONS" &&
      normalizedOptions.length ===
        0 &&
      normalizedCustom.length ===
        0
    ) {
      return res.status(400).json({
        error:
          "options_required",

        message:
          "Produsul configurabil trebuie să aibă cel puțin o opțiune sau un câmp de personalizare.",
      });
    }

    const product =
      await prisma.product.create({
        data: {
          serviceId:
            service.id,

          title:
            title.trim(),

          description:
            String(
              description || ""
            ),

          priceCents,

          currency:
            String(
              currency || "RON"
            ),

          images:
            normalizedImages,

          isActive:
            req.body.isActive !==
            false,

          isHidden:
            !!req.body.isHidden,

          moderationStatus:
            "PENDING",

          moderationMessage:
            null,

          submittedAt:
            new Date(),

          reviewedAt:
            null,

          reviewedByUserId:
            null,

          approvedAt:
            null,

          category:
            normalizedCategory,

          color:
            normalizedColor,

          availability:
            availabilityResult
              .availability,

          leadTimeDays:
            availabilityResult
              .leadTimeDays,

          readyQty:
            availabilityResult
              .readyQty,

          nextShipDate:
            availabilityResult
              .nextShipDate,

          acceptsCustom:
            normalizedOrderMode ===
              "OPTIONS" ||
            normalizedOrderMode ===
              "QUOTE_ONLY" ||
            !!acceptsCustom,

          orderMode:
            normalizedOrderMode,

          optionsSchema:
            normalizedOrderMode ===
            "OPTIONS"
              ? normalizedOptions
              : [],

          customSchema:
            normalizedOrderMode ===
            "OPTIONS"
              ? normalizedCustom
              : [],

          quoteSchema:
            normalizedOrderMode ===
            "QUOTE_ONLY"
              ? normalizedQuote
              : [],

          aiVisionAnalysis:
            normalizeAiJson(
              aiVisionAnalysis
            ),

          aiOrderAnalysis:
            normalizeAiJson(
              aiOrderAnalysis
            ),

          aiGeneratedFields:
            normalizeStringArray(
              aiGeneratedFields
            ),

          aiSourceImages:
            normalizeProductImages(
              aiSourceImages
            ),

          aiAnalysisVersion:
            aiAnalysisVersion
              ? String(
                  aiAnalysisVersion
                )
                  .trim()
                  .slice(0, 80)
              : null,

          aiConfidence:
            normalizeConfidence(
              aiConfidence
            ),

          aiAnalyzedAt:
            normalizeOptionalDate(
              aiAnalyzedAt
            ),

          aiManuallyEdited:
            !!aiManuallyEdited,

          materialMain:
            materialMain
              ? String(
                  materialMain
                ).trim()
              : null,

          technique:
            technique
              ? String(
                  technique
                ).trim()
              : null,

          styleTags:
            normalizeTags(
              styleTags
            ),

          occasionTags:
            normalizeTags(
              occasionTags
            ),

          dimensions:
            dimensions
              ? String(
                  dimensions
                ).trim()
              : null,

          careInstructions:
            careInstructions
              ? String(
                  careInstructions
                )
              : null,

          specialNotes:
            specialNotes
              ? String(
                  specialNotes
                )
              : null,
        },
      });

    return res
      .status(201)
      .json(
        mapProduct(product)
      );
  } catch (error) {
    console.error(
      "POST /vendors/store/:slug/products error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

/* =========================================================
   Actualizare produs
========================================================= */

export async function updateProduct(
  req,
  res
) {
  try {
    const id = String(
      req.params.id || ""
    );

    const product =
      await prisma.product.findUnique({
        where: {
          id,
        },

        include: {
          service: {
            include: {
              vendor: true,
              type: true,
            },
          },
        },
      });

    if (!product) {
      return res.status(404).json({
        error: "not_found",
      });
    }

    if (
      product.service?.vendor
        ?.userId !== req.user.sub
    ) {
      return res.status(403).json({
        error: "forbidden",
      });
    }

    if (
      product.service?.type
        ?.code !== "products"
    ) {
      return res.status(400).json({
        error:
          "not_a_products_store",
      });
    }

    const patch = {};

    const nextOrderMode =
      req.body.orderMode !==
      undefined
        ? normalizeOrderMode(
            req.body.orderMode
          )
        : normalizeOrderMode(
            product.orderMode
          );

    if (!nextOrderMode) {
      return res.status(400).json({
        error:
          "invalid_order_mode",
      });
    }

    const nextOptionsSchema =
      req.body.optionsSchema !==
      undefined
        ? normalizeOptionsSchema(
            req.body.optionsSchema
          )
        : normalizeOptionsSchema(
            product.optionsSchema
          );

    const nextCustomSchema =
      req.body.customSchema !==
      undefined
        ? normalizeCustomSchema(
            req.body.customSchema
          )
        : normalizeCustomSchema(
            product.customSchema
          );

    if (
      nextOrderMode ===
        "OPTIONS" &&
      nextOptionsSchema.length ===
        0 &&
      nextCustomSchema.length ===
        0
    ) {
      return res.status(400).json({
        error:
          "options_required",

        message:
          "Produsul configurabil trebuie să aibă cel puțin o opțiune sau personalizare.",
      });
    }

    if (
      req.body.title !==
      undefined
    ) {
      const title = String(
        req.body.title || ""
      ).trim();

      if (!title) {
        return res.status(400).json({
          error: "invalid_title",
        });
      }

      patch.title = title;
    }

    if (
      req.body.description !==
      undefined
    ) {
      patch.description =
        String(
          req.body.description ||
            ""
        );
    }

    if (
      req.body.price !==
      undefined
    ) {
      const numericPrice =
        Number(req.body.price);

      if (
        nextOrderMode !==
          "QUOTE_ONLY" &&
        (
          !Number.isFinite(
            numericPrice
          ) ||
          numericPrice <= 0
        )
      ) {
        return res.status(400).json({
          error: "invalid_price",
        });
      }

      patch.priceCents =
        nextOrderMode ===
        "QUOTE_ONLY"
          ? 0
          : Math.round(
              numericPrice * 100
            );
    } else if (
      nextOrderMode ===
      "QUOTE_ONLY"
    ) {
      patch.priceCents = 0;
    }

    if (
      req.body.images !==
      undefined
    ) {
      const images =
        normalizeProductImages(
          req.body.images
        );

      if (!images.length) {
        return res.status(400).json({
          error:
            "product_image_required",

          message:
            "Produsul trebuie să aibă cel puțin o imagine validă.",
        });
      }

      patch.images = images;
    }

    if (
      req.body.category !==
      undefined
    ) {
      const category =
        req.body.category == null
          ? ""
          : String(
              req.body.category
            ).trim();

      if (!category) {
        patch.category = null;
      } else {
        if (
          !CATEGORY_SET.has(category)
        ) {
          return res.status(400).json({
            error:
              "invalid_category",
          });
        }

        patch.category = category;
      }
    }

    if (
      req.body.color !==
      undefined
    ) {
      const color =
        req.body.color == null
          ? ""
          : String(
              req.body.color
            ).trim();

      if (!color) {
        patch.color = null;
      } else {
        if (!COLOR_SET.has(color)) {
          return res.status(400).json({
            error: "invalid_color",
          });
        }

        patch.color = color;
      }
    }

    const optionalTextFields = [
      "materialMain",
      "technique",
      "dimensions",
      "careInstructions",
      "specialNotes",
    ];

    for (
      const field of
      optionalTextFields
    ) {
      if (
        req.body[field] ===
        undefined
      ) {
        continue;
      }

      const value =
        req.body[field] == null
          ? ""
          : String(
              req.body[field]
            ).trim();

      patch[field] =
        value || null;
    }

    if (
      req.body.styleTags !==
      undefined
    ) {
      patch.styleTags =
        normalizeTags(
          req.body.styleTags
        );
    }

    if (
      req.body.occasionTags !==
      undefined
    ) {
      patch.occasionTags =
        normalizeTags(
          req.body.occasionTags
        );
    }

    const availabilityResult =
      normalizeAvailabilityPayload(
        req.body,
        product
      );

    if (
      availabilityResult.error
    ) {
      return res.status(400).json({
        error:
          availabilityResult.error,
      });
    }

    if (
      nextOrderMode ===
        "DIRECT" &&
      ![
  "READY",
  "MADE_TO_ORDER",
  "PREORDER",
  "SOLD_OUT",
].includes(
        availabilityResult.availability
      )
    ) {
      return res.status(400).json({
        error:
          "invalid_direct_availability",

        message:
          "Produsele care se cumpără direct trebuie să fie disponibile din stoc sau marcate ca epuizate.",
      });
    }

    patch.availability =
      availabilityResult.availability;

    patch.leadTimeDays =
      availabilityResult.leadTimeDays;

    patch.readyQty =
      availabilityResult.readyQty;

    patch.nextShipDate =
      availabilityResult.nextShipDate;

    if (
      req.body.orderMode !==
        undefined ||
      typeof req.body
        .acceptsCustom ===
        "boolean"
    ) {
      patch.acceptsCustom =
        nextOrderMode ===
          "OPTIONS" ||
        nextOrderMode ===
          "QUOTE_ONLY" ||
        req.body.acceptsCustom ===
          true;
    }

    if (
      req.body.orderMode !==
      undefined
    ) {
      patch.orderMode =
        nextOrderMode;
    }

    if (
      nextOrderMode ===
      "OPTIONS"
    ) {
      patch.optionsSchema =
        nextOptionsSchema;

      patch.customSchema =
        nextCustomSchema;

      patch.quoteSchema = [];
    }

    if (
      nextOrderMode ===
      "QUOTE_ONLY"
    ) {
      patch.optionsSchema = [];
      patch.customSchema = [];

      if (
        req.body.quoteSchema !==
        undefined
      ) {
        patch.quoteSchema =
          normalizeQuoteSchema(
            getSchemaFields(
              req.body.quoteSchema
            ).length
              ? req.body.quoteSchema
              : defaultQuoteSchema()
          );
      } else if (
        normalizeOrderMode(
          product.orderMode
        ) !== "QUOTE_ONLY"
      ) {
        patch.quoteSchema =
          normalizeQuoteSchema(
            defaultQuoteSchema()
          );
      }
    }

    if (
      nextOrderMode ===
      "DIRECT"
    ) {
      patch.optionsSchema = [];
      patch.customSchema = [];
      patch.quoteSchema = [];
    }

    if (
      req.body.aiVisionAnalysis !==
      undefined
    ) {
      patch.aiVisionAnalysis =
        normalizeAiJson(
          req.body.aiVisionAnalysis
        );
    }

    if (
      req.body.aiOrderAnalysis !==
      undefined
    ) {
      patch.aiOrderAnalysis =
        normalizeAiJson(
          req.body.aiOrderAnalysis
        );
    }

    if (
      req.body.aiGeneratedFields !==
      undefined
    ) {
      patch.aiGeneratedFields =
        normalizeStringArray(
          req.body.aiGeneratedFields
        );
    }

    if (
      req.body.aiSourceImages !==
      undefined
    ) {
      patch.aiSourceImages =
        normalizeProductImages(
          req.body.aiSourceImages
        );
    }

    if (
      req.body.aiAnalysisVersion !==
      undefined
    ) {
      patch.aiAnalysisVersion =
        req.body.aiAnalysisVersion
          ? String(
              req.body
                .aiAnalysisVersion
            )
              .trim()
              .slice(0, 80)
          : null;
    }

    if (
      req.body.aiConfidence !==
      undefined
    ) {
      patch.aiConfidence =
        normalizeConfidence(
          req.body.aiConfidence
        );
    }

    if (
      req.body.aiAnalyzedAt !==
      undefined
    ) {
      patch.aiAnalyzedAt =
        normalizeOptionalDate(
          req.body.aiAnalyzedAt
        );
    }

    if (
      typeof req.body
        .aiManuallyEdited ===
      "boolean"
    ) {
      patch.aiManuallyEdited =
        req.body.aiManuallyEdited;
    }

    if (
      typeof req.body.isActive ===
      "boolean"
    ) {
      patch.isActive =
        req.body.isActive;
    }

    if (
      typeof req.body.isHidden ===
      "boolean"
    ) {
      patch.isHidden =
        req.body.isHidden;
    }

    const contentFieldsChanged =
      req.body.title !==
        undefined ||
      req.body.description !==
        undefined ||
      req.body.price !==
        undefined ||
      req.body.images !==
        undefined ||
      req.body.category !==
        undefined ||
      req.body.color !==
        undefined ||
      req.body.materialMain !==
        undefined ||
      req.body.technique !==
        undefined ||
      req.body.styleTags !==
        undefined ||
      req.body.occasionTags !==
        undefined ||
      req.body.dimensions !==
        undefined ||
      req.body.careInstructions !==
        undefined ||
      req.body.specialNotes !==
        undefined ||
      req.body.orderMode !==
        undefined ||
      req.body.optionsSchema !==
        undefined ||
      req.body.customSchema !==
        undefined ||
      req.body.quoteSchema !==
        undefined;

    if (contentFieldsChanged) {
      patch.moderationStatus =
        "PENDING";

      patch.moderationMessage =
        null;

      patch.submittedAt =
        new Date();

      patch.reviewedAt =
        null;

      patch.reviewedByUserId =
        null;

      patch.approvedAt =
        null;
    }

    const updated =
      await prisma.product.update({
        where: {
          id,
        },

        data: patch,
      });

    return res.json(
      mapProduct(updated)
    );
  } catch (error) {
    console.error(
      "PUT /vendors/products/:id error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}

/* =========================================================
   Arhivare produs
========================================================= */

export async function deleteProduct(
  req,
  res
) {
  try {
    const id = String(
      req.params.id || ""
    );

    const product =
      await prisma.product.findUnique({
        where: {
          id,
        },

        include: {
          service: {
            include: {
              vendor: true,
              type: true,
            },
          },
        },
      });

    if (!product) {
      return res.status(404).json({
        error: "not_found",
      });
    }

    if (
      product.service?.vendor
        ?.userId !== req.user.sub
    ) {
      return res.status(403).json({
        error: "forbidden",
      });
    }

    if (
      product.service?.type
        ?.code !== "products"
    ) {
      return res.status(400).json({
        error:
          "not_a_products_store",
      });
    }

    const archived =
      await prisma.product.update({
        where: {
          id,
        },

        data: {
          isActive: false,
          isHidden: true,
        },

        select: {
          id: true,
        },
      });

    return res.json({
      ok: true,

      archivedId:
        archived.id,
    });
  } catch (error) {
    console.error(
      "DELETE /vendors/products/:id error:",
      error
    );

    return res.status(500).json({
      error: "server_error",
    });
  }
}