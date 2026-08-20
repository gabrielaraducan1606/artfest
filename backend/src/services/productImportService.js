import * as XLSX from "xlsx";

/**
 * Număr maxim de rânduri acceptate într-un singur import.
 * Putem crește ulterior dacă este nevoie.
 */
export const MAX_IMPORT_ROWS = 5000;

/* =========================================================
   Helpers
========================================================= */

function cleanText(value) {
  if (value === null || value === undefined) return "";

  return String(value).trim();
}

function normalizeColumnName(value) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompact(value) {
  return normalizeColumnName(value).replace(/\s+/g, "");
}

function numberFromValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  let text = String(value)
    .trim()
    .replace(/\s/g, "");

  if (!text) return null;

  text = text
    .replace(/lei/gi, "")
    .replace(/ron/gi, "")
    .replace(/eur/gi, "")
    .replace(/€/g, "");

  if (
    text.includes(".") &&
    text.includes(",")
  ) {
    if (
      text.lastIndexOf(",") >
      text.lastIndexOf(".")
    ) {
      text = text
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  text = text.replace(
    /[^0-9.+-]/g,
    ""
  );

  if (!text) return null;

  const result = Number(text);

  return Number.isFinite(result)
    ? result
    : null;
}

function integerFromValue(value) {
  const number =
    numberFromValue(value);

  if (number === null) {
    return null;
  }

  return Math.max(
    0,
    Math.floor(number)
  );
}

function booleanFromValue(
  value,
  fallback = null
) {
  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  const text = normalizeColumnName(
    value
  );

  if (!text) return fallback;

  if (
    [
      "da",
      "yes",
      "true",
      "1",
      "activ",
      "active",
    ].includes(text)
  ) {
    return true;
  }

  if (
    [
      "nu",
      "no",
      "false",
      "0",
      "inactiv",
      "inactive",
    ].includes(text)
  ) {
    return false;
  }

  return fallback;
}

function splitValues(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map(cleanText)
      .filter(Boolean);
  }

  const text = cleanText(value);

  if (!text) return [];

  return text
    .split(/\s*[|;,]\s*/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitImages(value) {
  return splitValues(value).filter(
    (value) => {
      try {
        const url = new URL(value);

        return (
          url.protocol === "http:" ||
          url.protocol === "https:"
        );
      } catch {
        return false;
      }
    }
  );
}

function safeJsonValue(value) {
  if (value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (
    typeof value === "number" &&
    !Number.isFinite(value)
  ) {
    return null;
  }

  return value;
}

function cleanRawRow(row) {
  const result = {};

  for (
    const [key, value] of Object.entries(
      row || {}
    )
  ) {
    result[String(key)] =
      safeJsonValue(value);
  }

  return result;
}

/* =========================================================
   Detectare coloane
========================================================= */

const FIELD_ALIASES = {
  title: [
    "title",
    "name",
    "product",
    "product name",
    "product_name",
    "product title",
    "product_title",
    "nume",
    "denumire",
    "denumire produs",
    "nume produs",
    "titlu",
    "titlu produs",
  ],

  description: [
    "description",
    "product description",
    "product_description",
    "descriere",
    "descriere produs",
    "details",
    "detalii",
  ],

  price: [
    "price",
    "product price",
    "product_price",
    "sale price",
    "sale_price",
    "pret",
    "pret produs",
    "pret vanzare",
    "valoare",
  ],

  stock: [
    "stock",
    "inventory",
    "quantity",
    "qty",
    "available quantity",
    "available_quantity",
    "stoc",
    "cantitate",
    "cantitate disponibila",
  ],

  sku: [
    "sku",
    "product sku",
    "product_sku",
    "code",
    "product code",
    "product_code",
    "cod",
    "cod produs",
  ],

  category: [
    "category",
    "product category",
    "product_category",
    "categorie",
    "categorie produs",
    "category name",
  ],

  image: [
    "image",
    "image url",
    "image_url",
    "photo",
    "photo url",
    "photo_url",
    "poza",
    "imagine",
    "imagine principala",
  ],

  images: [
    "images",
    "image urls",
    "image_urls",
    "photos",
    "pictures",
    "imagini",
    "poze",
    "galerie",
  ],

  variants: [
    "variants",
    "variant",
    "options",
    "option",
    "variante",
    "varianta",
    "optiuni",
    "optiune",
    "atribute",
  ],

  availability: [
    "availability",
    "available",
    "disponibilitate",
    "disponibil",
    "status stoc",
  ],

  orderMode: [
    "order mode",
    "ordermode",
    "order_mode",
    "mod comanda",
    "mod de comanda",
    "tip comanda",
    "tip de comanda",
  ],

  color: [
    "color",
    "colour",
    "culoare",
  ],

  materialMain: [
    "material",
    "main material",
    "material principal",
  ],

  dimensions: [
    "dimensions",
    "dimension",
    "size",
    "dimensiuni",
    "dimensiune",
  ],

  leadTimeDays: [
    "lead time",
    "lead time days",
    "production days",
    "zile productie",
    "timp productie",
    "termen productie",
  ],

  isActive: [
    "active",
    "is active",
    "status",
    "activ",
  ],
};

function scoreAlias(
  columnName,
  alias
) {
  const column =
    normalizeColumnName(columnName);

  const normalizedAlias =
    normalizeColumnName(alias);

  if (!column || !normalizedAlias) {
    return 0;
  }

  if (column === normalizedAlias) {
    return 1;
  }

  if (
    normalizeCompact(column) ===
    normalizeCompact(normalizedAlias)
  ) {
    return 0.98;
  }

  if (
    column.startsWith(
      normalizedAlias
    ) ||
    normalizedAlias.startsWith(
      column
    )
  ) {
    return 0.84;
  }

  if (
    column.includes(
      normalizedAlias
    ) ||
    normalizedAlias.includes(
      column
    )
  ) {
    return 0.74;
  }

  return 0;
}

export function detectFieldForColumn(
  columnName
) {
  let bestField = "ignore";
  let bestScore = 0;

  for (
    const [
      field,
      aliases,
    ] of Object.entries(
      FIELD_ALIASES
    )
  ) {
    for (const alias of aliases) {
      const score = scoreAlias(
        columnName,
        alias
      );

      if (score > bestScore) {
        bestScore = score;
        bestField = field;
      }
    }
  }

  if (bestScore < 0.7) {
    return {
      mappedTo: "ignore",
      confidence: Math.max(
        0.3,
        bestScore
      ),
    };
  }

  return {
    mappedTo: bestField,
    confidence: bestScore,
  };
}

/* =========================================================
   Parse Excel / CSV
========================================================= */

export function parseSpreadsheetBuffer({
  buffer,
  fileName,
}) {
  if (!buffer) {
    throw new Error(
      "Fișierul nu conține date."
    );
  }

  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: true,
    dense: false,
  });

  if (
    !workbook.SheetNames?.length
  ) {
    throw new Error(
      "Fișierul nu conține niciun sheet."
    );
  }

  const sheetName =
    workbook.SheetNames[0];

  const worksheet =
    workbook.Sheets[sheetName];

  if (!worksheet) {
    throw new Error(
      "Primul sheet nu poate fi citit."
    );
  }

  const rows = XLSX.utils.sheet_to_json(
    worksheet,
    {
      defval: null,
      raw: false,
      blankrows: false,
    }
  );

  if (!rows.length) {
    throw new Error(
      "Fișierul nu conține produse."
    );
  }

  if (
    rows.length > MAX_IMPORT_ROWS
  ) {
    throw new Error(
      `Fișierul are ${rows.length} rânduri. Limita actuală este de ${MAX_IMPORT_ROWS} produse per import.`
    );
  }

  const headers = Array.from(
    new Set(
      rows.flatMap((row) =>
        Object.keys(row || {})
      )
    )
  );

  if (!headers.length) {
    throw new Error(
      "Nu am găsit coloane în fișier."
    );
  }

  const columns = headers.map(
    (source) => {
      const firstValue = rows.find(
        (row) =>
          row[source] !== null &&
          row[source] !== undefined &&
          String(row[source]).trim() !==
            ""
      )?.[source];

      const detected =
        detectFieldForColumn(source);

      return {
        source,
        sample:
          firstValue === undefined
            ? ""
            : cleanText(firstValue).slice(
                0,
                180
              ),
        mappedTo:
          detected.mappedTo,
        confidence:
          detected.confidence,
      };
    }
  );

  return {
    sheetName,
    fileName:
      fileName || "import",
    rows: rows.map(cleanRawRow),
    columns,
  };
}

/* =========================================================
   Mapping
========================================================= */

export function mappingFromColumns(
  columns = []
) {
  const mapping = {};

  for (const column of columns) {
    if (!column?.source) continue;

    mapping[column.source] =
      column.mappedTo || "ignore";
  }

  return mapping;
}

function findMappedValue(
  rawData,
  mapping,
  targetField
) {
  for (
    const [
      sourceColumn,
      mappedField,
    ] of Object.entries(
      mapping || {}
    )
  ) {
    if (
      mappedField === targetField
    ) {
      return rawData?.[
        sourceColumn
      ];
    }
  }

  return undefined;
}

/* =========================================================
   Normalizare produs
========================================================= */

function normalizeAvailability(
  value
) {
  const text = normalizeColumnName(
    value
  );

  if (!text) return null;

  if (
    [
      "ready",
      "available",
      "in stock",
      "instock",
      "disponibil",
      "in stoc",
    ].includes(text)
  ) {
    return "READY";
  }

  if (
    [
      "made to order",
      "made_to_order",
      "la comanda",
      "pe comanda",
    ].includes(text)
  ) {
    return "MADE_TO_ORDER";
  }

  if (
    [
      "preorder",
      "pre order",
      "precomanda",
    ].includes(text)
  ) {
    return "PREORDER";
  }

  if (
    [
      "sold out",
      "sold_out",
      "out of stock",
      "stoc epuizat",
      "epuizat",
      "indisponibil",
    ].includes(text)
  ) {
    return "SOLD_OUT";
  }

  return null;
}

function normalizeOrderMode(
  value
) {
  const text =
    normalizeColumnName(value);

  if (!text) {
    return null;
  }

  if (
    [
      "direct",
      "ready to buy",
      "ready_to_buy",
      "cumparare directa",
      "cumparare direct",
      "direct purchase",
    ].includes(text)
  ) {
    return "DIRECT";
  }

  if (
    [
      "options",
      "option",
      "optiuni",
      "optiune",
      "variante",
      "varianta",
    ].includes(text)
  ) {
    return "OPTIONS";
  }

  if (
    [
      "customizable",
      "customisable",
      "personalizabil",
      "personalizare",
      "personalizat",
    ].includes(text)
  ) {
    return "CUSTOMIZABLE";
  }

  if (
    [
      "quote only",
      "quote_only",
      "quote",
      "cerere oferta",
      "cerere de oferta",
      "oferta",
    ].includes(text)
  ) {
    return "QUOTE_ONLY";
  }

  return null;
}

export function normalizeImportRow({
  rawData,
  mapping,
}) {
  const title = cleanText(
    findMappedValue(
      rawData,
      mapping,
      "title"
    )
  );

  const description = cleanText(
    findMappedValue(
      rawData,
      mapping,
      "description"
    )
  );

  const priceValue =
    findMappedValue(
      rawData,
      mapping,
      "price"
    );

  const price =
    numberFromValue(priceValue);

  const stockValue =
    findMappedValue(
      rawData,
      mapping,
      "stock"
    );

  const readyQty =
    integerFromValue(stockValue);

  const category = cleanText(
    findMappedValue(
      rawData,
      mapping,
      "category"
    )
  );

  const image = cleanText(
    findMappedValue(
      rawData,
      mapping,
      "image"
    )
  );

  const imagesValue =
    findMappedValue(
      rawData,
      mapping,
      "images"
    );

  let images =
    splitImages(imagesValue);

  if (image) {
    try {
      const parsed =
        new URL(image);

      if (
        parsed.protocol ===
          "http:" ||
        parsed.protocol ===
          "https:"
      ) {
        images = [
          image,
          ...images,
        ];
      }
    } catch {
      // imagine invalidă
    }
  }

  images = Array.from(
    new Set(images)
  );

  const sku = cleanText(
    findMappedValue(
      rawData,
      mapping,
      "sku"
    )
  );

  const variants = cleanText(
    findMappedValue(
      rawData,
      mapping,
      "variants"
    )
  );

  const color = cleanText(
    findMappedValue(
      rawData,
      mapping,
      "color"
    )
  );

  const materialMain = cleanText(
    findMappedValue(
      rawData,
      mapping,
      "materialMain"
    )
  );

  const dimensions = cleanText(
    findMappedValue(
      rawData,
      mapping,
      "dimensions"
    )
  );

  const leadTimeDays =
    integerFromValue(
      findMappedValue(
        rawData,
        mapping,
        "leadTimeDays"
      )
    );

  const isActive =
    booleanFromValue(
      findMappedValue(
        rawData,
        mapping,
        "isActive"
      ),
      true
    );

  const availabilityRaw =
    findMappedValue(
      rawData,
      mapping,
      "availability"
    );

  const availability =
    normalizeAvailability(
      availabilityRaw
    );

  const orderModeRaw =
    findMappedValue(
      rawData,
      mapping,
      "orderMode"
    );

  const orderMode =
    normalizeOrderMode(
      orderModeRaw
    );

  return {
    title,

    description:
      description || null,

    price:
      price === null
        ? null
        : price,

    priceCents:
      price === null
        ? null
        : Math.round(
            price * 100
          ),

    stock:
      readyQty,

    readyQty:
      readyQty ?? 0,

    category:
      category || null,

    images,

    sku:
      sku || null,

    variants:
      variants || null,

    color:
      color || null,

    materialMain:
      materialMain || null,

    dimensions:
      dimensions || null,

    leadTimeDays:
      leadTimeDays ?? null,

    availability:
      availability || null,

    availabilityRaw:
      availabilityRaw ===
        undefined
        ? null
        : cleanText(
            availabilityRaw
          ),

    orderMode:
      orderMode || "DIRECT",

    orderModeRaw:
      orderModeRaw ===
        undefined
        ? null
        : cleanText(
            orderModeRaw
          ),

    isActive:
      isActive ?? true,
  };
}

/* =========================================================
   Validare preview
========================================================= */

export function validateNormalizedProduct(
  product
) {
  const warnings = [];
  const errors = [];

  if (!product.title) {
    errors.push(
      "Titlul produsului este obligatoriu."
    );
  }

  if (
    product.title &&
    product.title.length > 250
  ) {
    warnings.push(
      "Titlul este foarte lung."
    );
  }

  if (
    product.priceCents === null
  ) {
    errors.push(
      "Prețul produsului este obligatoriu."
    );
  } else if (
    product.priceCents < 0
  ) {
    errors.push(
      "Prețul nu poate fi negativ."
    );
  }

  if (!product.description) {
    warnings.push(
      "Descrierea este goală."
    );
  }

  if (!product.category) {
    warnings.push(
      "Categoria nu este completată."
    );
  }

  if (!product.images.length) {
    warnings.push(
      "Produsul nu are imagini."
    );
  }

  if (
    product.availabilityRaw &&
    !product.availability
  ) {
    warnings.push(
      `Disponibilitatea "${product.availabilityRaw}" nu a fost recunoscută. Va fi folosită valoarea implicită READY.`
    );
  }

  if (
    product.orderModeRaw &&
    !normalizeOrderMode(
      product.orderModeRaw
    )
  ) {
    warnings.push(
      `Modul de comandă "${product.orderModeRaw}" nu a fost recunoscut. Va fi folosit DIRECT.`
    );
  }

  if (product.sku) {
    warnings.push(
      "SKU-ul a fost identificat, dar catalogul Artfest nu are încă un câmp SKU dedicat."
    );
  }

  if (product.variants) {
    warnings.push(
      "Variantele au fost identificate, dar trebuie verificate înainte de transformarea lor în opțiuni Artfest."
    );
  }

  /*
   * OPTIONS și CUSTOMIZABLE pot fi importate ca mod,
   * dar încă nu generăm optionsSchema/customSchema.
   */
  if (
    product.orderMode ===
      "OPTIONS" &&
    !product.variants
  ) {
    warnings.push(
      "Produsul este setat pe OPTIONS, dar nu au fost identificate variante."
    );
  }

  if (
    product.orderMode ===
    "CUSTOMIZABLE"
  ) {
    warnings.push(
      "Produsul este setat ca personalizabil, dar câmpurile de personalizare nu sunt încă generate automat din Excel."
    );
  }

  let status = "READY";

  if (warnings.length) {
    status = "WARNING";
  }

  if (errors.length) {
    status = "ERROR";
  }

  return {
    status,
    warnings,
    errors,
  };
}

/* =========================================================
   Preview row pentru frontend
========================================================= */

export function makePreviewRow(
  item
) {
  const data =
    item.normalizedData || {};

  return {
    id: item.id,

    rowNumber:
      item.rowNumber,

    title:
      data.title || "",

    description:
      data.description || "",

    price:
      data.price ??
      (
        data.priceCents !==
          null &&
        data.priceCents !==
          undefined
          ? Number(
              data.priceCents
            ) / 100
          : null
      ),

    stock:
      data.readyQty ??
      data.stock ??
      null,

    category:
      data.category || "",

    image:
      Array.isArray(
        data.images
      )
        ? data.images[0] || ""
        : "",

    orderMode:
      data.orderMode ||
      "DIRECT",

    availability:
      data.availability ||
      null,

    status:
      item.status,

    warnings: [
      ...(
        Array.isArray(
          item.warnings
        )
          ? item.warnings
          : []
      ),

      ...(
        Array.isArray(
          item.errors
        )
          ? item.errors
          : []
      ),
    ],
  };
}

/* =========================================================
   Date pentru Product.create()
========================================================= */

export function buildProductCreateData({
  normalizedData,
  serviceId,
}) {
  const data =
    normalizedData || {};

  if (!data.title) {
    throw new Error(
      "Produs fără titlu."
    );
  }

  if (
    data.priceCents === null ||
    data.priceCents === undefined
  ) {
    throw new Error(
      "Produs fără preț."
    );
  }

  const productData = {
    serviceId,

    title: String(
      data.title
    ).trim(),

    description:
      data.description || null,

    priceCents: Math.max(
      0,
      Math.round(
        Number(
          data.priceCents
        )
      )
    ),

    currency: "RON",

    images:
      Array.isArray(
        data.images
      )
        ? data.images
        : [],

    isActive:
      data.isActive !== false,

    category:
      data.category || null,

    color:
      data.color || null,

    readyQty:
      Number.isFinite(
        Number(
          data.readyQty
        )
      )
        ? Math.max(
            0,
            Math.floor(
              Number(
                data.readyQty
              )
            )
          )
        : 0,

    /*
     * Pentru CUSTOMIZABLE îl marcăm
     * deja ca acceptând personalizare.
     */
    acceptsCustom:
      data.orderMode ===
      "CUSTOMIZABLE",

    materialMain:
      data.materialMain ||
      null,

    dimensions:
      data.dimensions ||
      null,

    styleTags: [],
    occasionTags: [],

    orderMode:
      data.orderMode ||
      "DIRECT",

    moderationStatus:
      "PENDING",
  };

  if (
    data.leadTimeDays !==
      null &&
    data.leadTimeDays !==
      undefined
  ) {
    productData.leadTimeDays =
      Math.max(
        0,
        Math.floor(
          Number(
            data.leadTimeDays
          )
        )
      );
  }

  if (
    data.availability
  ) {
    productData.availability =
      data.availability;
  }

  return productData;
}