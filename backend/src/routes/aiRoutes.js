import { Router } from "express";
import { toFile } from "openai/uploads";
import {
  authRequired,
  requireRole,
  enforceTokenVersion,
} from "../api/auth.js";
import { openai } from "../lib/openai.js";
import { CATEGORIES, CATEGORY_LABELS } from "../constants/categories.js";
import { COLORS, COLOR_LABELS } from "../constants/colors.js";

const router = Router();

const aiVendorAccess = [
  authRequired,
  enforceTokenVersion,
  requireRole("VENDOR", "ADMIN"),
];

function safeJsonParse(text) {
  let raw = String(text || "").trim();

  raw = raw
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(raw);
  } catch {}

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {}
  }

  return null;
}

function cleanArray(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8);
  }

  if (typeof value === "string") {
    return value.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 8);
  }

  return [];
}

async function imageUrlToFile(imageUrl) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error("Nu am putut descărca imaginea.");
  }

  const contentType = response.headers.get("content-type") || "image/png";

  if (!contentType.startsWith("image/")) {
    throw new Error("URL-ul nu pare să fie o imagine validă.");
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return toFile(buffer, "product-image.png", {
    type: contentType,
  });
}

router.get("/test", authRequired, requireRole("ADMIN"), (_req, res) => {
  res.json({ ok: true, message: "AI route works" });
});

router.post("/product-analyze", aiVendorAccess, async (req, res) => {
  try {
    const images = Array.isArray(req.body?.images)
      ? req.body.images.filter(Boolean).slice(0, 4)
      : [];

    if (!images.length) {
      return res.status(400).json({
        error: "no_images",
        message: "Încarcă cel puțin o imagine pentru analiză AI.",
      });
    }

    const categoriesText = CATEGORIES.map(
      (key) => `${key} = ${CATEGORY_LABELS[key] || key}`
    ).join("\n");

    const colorsText = COLORS.map(
      (key) => `${key} = ${COLOR_LABELS[key] || key}`
    ).join("\n");

    const response = await openai.responses.create({
      model: "gpt-4.1",
      text: {
        format: { type: "json_object" },
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
Analizează produsul handmade din imagini pentru un marketplace românesc.

Returnează EXCLUSIV JSON valid. Fără markdown.

Reguli:
- Scrie în română.
- Nu inventa detalii.
- Alege category DOAR din lista permisă.
- Alege color DOAR din lista permisă.
- Dacă are mai multe culori, folosește color: "multicolor".
- Titlul maxim 80 caractere.
- Descrierea 2-4 paragrafe scurte.

Categorii permise:
${categoriesText}

Culori permise:
${colorsText}

Schema exactă:
{
  "title": "",
  "description": "",
  "category": "",
  "materialMain": "",
  "technique": "",
  "color": "",
  "styleTags": [],
  "occasionTags": [],
  "careInstructions": "",
  "specialNotes": ""
}
`,
            },
            ...images.map((url) => ({
              type: "input_image",
              image_url: String(url),
            })),
          ],
        },
      ],
    });

    const parsed = safeJsonParse(response.output_text);

    if (!parsed) {
      return res.status(500).json({
        error: "invalid_ai_json",
        raw: response.output_text,
      });
    }

    return res.json({
      title: String(parsed.title || "").trim(),
      description: String(parsed.description || "").trim(),
      category: CATEGORIES.includes(parsed.category) ? parsed.category : "alte",
      materialMain: String(parsed.materialMain || "").trim(),
      technique: String(parsed.technique || "").trim(),
      color: COLORS.includes(parsed.color) ? parsed.color : "multicolor",
      styleTags: cleanArray(parsed.styleTags),
      occasionTags: cleanArray(parsed.occasionTags),
      careInstructions: String(parsed.careInstructions || "").trim(),
      specialNotes: String(parsed.specialNotes || "").trim(),
    });
  } catch (err) {
    console.error("AI product analyze error:", err);

    return res.status(500).json({
      error: "ai_product_analyze_failed",
      message: err?.message || "Analiza AI a eșuat.",
    });
  }
});

router.post("/product-image-enhance", aiVendorAccess, async (req, res) => {
  try {
    const imageUrl = String(req.body?.imageUrl || "").trim();
    const variant = Number(req.body?.variant || 1);

    if (!imageUrl) {
      return res.status(400).json({
        error: "no_image",
        message: "Trimite imageUrl pentru editare.",
      });
    }

    const imageFile = await imageUrlToFile(imageUrl);

   const prompt = `
PRODUCT PRESERVATION IS THE HIGHEST PRIORITY.

The product itself is LOCKED and must remain visually identical.

DO NOT:
- redesign the product
- regenerate the product
- improve the product
- beautify the product
- change the shape
- change proportions
- change dimensions
- change colors
- change texture
- change fabric weave
- change crochet patterns
- change knitting patterns
- change stitching
- change embroidery
- change brush strokes
- change ceramic details
- change wood grain
- change resin effects
- change surface details
- remove imperfections from the product
- add details to the product
- smooth the product
- sharpen product details artificially
- replace any part of the product

The product must remain exactly the same object from the original photo.

Treat the product as READ ONLY.
Treat only the environment around the product as editable.

You may modify ONLY:
- background
- lighting
- exposure
- white balance
- shadows
- overall photo cleanliness

Background rules:
- use a clean minimalist e-commerce background
- neutral and elegant
- no props
- no decorations
- no additional objects
- no text
- no logo
- no watermark

Style:
- realistic studio photography
- realistic catalog photography
- soft natural light
- centered product
- square 1:1 composition

Final requirement:
The result must look like the SAME PHOTO taken by a professional photographer.
It must NOT look AI generated.
It must NOT look like a newly generated product image.

Variant: ${variant}
`;
    const result = await openai.images.edit({
      model: "gpt-image-1",
      image: imageFile,
      prompt,
      size: "1024x1024",
      quality: "medium",
    });

    const b64 = result.data?.[0]?.b64_json;

    if (!b64) {
      return res.status(500).json({
        error: "no_image_generated",
        message: "OpenAI nu a returnat imaginea editată.",
      });
    }

    return res.json({
      ok: true,
      imageBase64: b64,
      dataUrl: `data:image/png;base64,${b64}`,
    });
  } catch (err) {
    console.error("AI image enhance error:", err);

    return res.status(500).json({
      error: "ai_image_enhance_failed",
      message: err?.message || "Editarea imaginii a eșuat.",
    });
  }
});

export default router;