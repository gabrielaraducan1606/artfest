import { openai } from "../lib/openai.js";

export async function analyzeProductImages(images = []) {
  if (!Array.isArray(images) || !images.length) {
    throw new Error("No images provided");
  }

  const response = await openai.responses.create({
    model: "gpt-4.1",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
Analizeaza produsul handmade din imagini.

Returneaza EXCLUSIV JSON valid.

{
  "title": "",
  "description": "",
  "category": "",
  "materialMain": "",
  "technique": "",
  "color": "",
  "styleTags": [],
  "occasionTags": [],
  "careInstructions": ""
}
`,
          },

          ...images.map((url) => ({
            type: "input_image",
            image_url: url,
          })),
        ],
      },
    ],
  });

  return response.output_text;
}