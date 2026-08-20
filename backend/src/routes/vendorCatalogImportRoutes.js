// src/routes/vendorCatalogImportRoutes.js

import express from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import * as XLSX from "xlsx";

import { prisma } from "../db.js";

import {
  parseSpreadsheetBuffer,
  mappingFromColumns,
  normalizeImportRow,
  validateNormalizedProduct,
  makePreviewRow,
  buildProductCreateData,
} from "../services/productImportService.js";

import {
  CATALOG_IMPORTS_MANIFEST,
  getCatalogImportRoute,
} from "../ai/manifests/catalogImports.manifest.js";

const router = express.Router();

const JWT_SECRET =
  process.env.JWT_SECRET || "dev-secret-change-me";

const TOKEN_COOKIE = "token";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/* =========================================================
   UPLOAD CONFIG
========================================================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
   fileSize:
  CATALOG_IMPORTS_MANIFEST
    .limits
    .maxFileSizeMb *
  1024 *
  1024,
    files: 1,
    fields: 10,
  },

  fileFilter(req, file, cb) {
    const name = String(
      file.originalname || ""
    ).toLowerCase();

    const accepted =
      name.endsWith(".xlsx") ||
      name.endsWith(".xls") ||
      name.endsWith(".csv");

    if (!accepted) {
      return cb(
        new Error(
          "Sunt acceptate doar fișiere .xlsx, .xls sau .csv."
        )
      );
    }

    cb(null, true);
  },
});

/* =========================================================
   AUTH
========================================================= */

function getTokenFromReq(req) {
  const fromCookie =
    req.cookies?.[TOKEN_COOKIE];

  if (fromCookie) {
    return fromCookie;
  }

  const authorization =
    req.headers.authorization;

  if (
    authorization?.startsWith(
      "Bearer "
    )
  ) {
    return authorization.slice(7);
  }

  return null;
}

async function requireVendor(
  req,
  res,
  next
) {
  try {
    const token =
      getTokenFromReq(req);

    if (!token) {
      return res
        .status(401)
        .json({
          error: "unauthenticated",
        });
    }

    const payload =
      jwt.verify(
        token,
        JWT_SECRET
      );

    const userId =
      payload?.sub;

    if (!userId) {
      return res
        .status(401)
        .json({
          error: "invalid_token",
        });
    }

    const user =
      await prisma.user.findUnique({
        where: {
          id: userId,
        },

        select: {
          id: true,
          role: true,
          tokenVersion: true,

          vendor: {
            select: {
              id: true,
              isActive: true,
            },
          },
        },
      });

    if (!user) {
      return res
        .status(401)
        .json({
          error: "user_not_found",
        });
    }

    if (
      payload.tv !== undefined &&
      Number(payload.tv) !==
        Number(user.tokenVersion)
    ) {
      return res
        .status(401)
        .json({
          error: "token_revoked",
        });
    }

    if (
      user.role !== "VENDOR" ||
      !user.vendor
    ) {
      return res
        .status(403)
        .json({
          error: "vendor_required",
        });
    }

    if (
      user.vendor.isActive ===
      false
    ) {
      return res
        .status(403)
        .json({
          error: "vendor_inactive",
        });
    }

    req.authUser = {
      id: user.id,
      role: user.role,
    };

    req.vendor =
      user.vendor;

    next();
  } catch (error) {
    console.error(
      "[catalog-import] auth:",
      error
    );

    return res
      .status(401)
      .json({
        error: "invalid_token",
      });
  }
}

router.use(requireVendor);

/* =========================================================
   HELPERS
========================================================= */

async function resolveService({
  vendorId,
  serviceId,
}) {
  if (serviceId) {
    const service =
      await prisma.vendorService.findFirst({
        where: {
          id: serviceId,
          vendorId,
        },

        select: {
          id: true,
          vendorId: true,
          title: true,
          isActive: true,
        },
      });

    if (!service) {
      const error =
        new Error(
          "Magazinul selectat nu există sau nu îți aparține."
        );

      error.statusCode = 404;

      throw error;
    }

    return service;
  }

  const services =
    await prisma.vendorService.findMany({
      where: {
        vendorId,
      },

      orderBy: {
        createdAt: "asc",
      },

      select: {
        id: true,
        vendorId: true,
        title: true,
        isActive: true,
      },

      take: 2,
    });

  if (!services.length) {
    const error =
      new Error(
        "Nu ai niciun magazin în care să putem importa produsele."
      );

    error.statusCode = 400;

    throw error;
  }

  if (
    services.length === 1
  ) {
    return services[0];
  }

  const error =
    new Error(
      "Ai mai multe magazine. Selectează magazinul în care vrei să imporți produsele."
    );

  error.statusCode = 400;
  error.code =
    "SERVICE_REQUIRED";

  throw error;
}

async function getOwnedImport({
  importId,
  vendorId,
  includeItems = false,
}) {
  return prisma.productImport.findFirst({
    where: {
      id: importId,
      vendorId,
    },

    include: includeItems
      ? {
          items: {
            orderBy: {
              rowNumber: "asc",
            },
          },
        }
      : undefined,
  });
}

function parseMapping(body) {
  const mapping =
    body?.mapping;

  if (
    !mapping ||
    typeof mapping !==
      "object" ||
    Array.isArray(mapping)
  ) {
    return null;
  }

  return mapping;
}

/* =========================================================
   EXCEL HELPERS
========================================================= */

function jsonCell(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  try {
    return JSON.stringify(
      value
    );
  } catch {
    return "";
  }
}

function dateCell(value) {
  if (!value) return "";

  try {
    return new Date(
      value
    ).toISOString();
  } catch {
    return "";
  }
}

function safeFileName(value) {
  return String(
    value || "artfest"
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-zA-Z0-9-_]+/g,
      "-"
    )
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function setColumnWidths(
  worksheet,
  widths
) {
  worksheet["!cols"] =
    widths.map((wch) => ({
      wch,
    }));
}

function sendWorkbook(
  res,
  workbook,
  fileName
) {
  const buffer =
    XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

  res.setHeader(
    "Content-Type",
    XLSX_MIME
  );

  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileName}"`
  );

  res.setHeader(
    "Content-Length",
    buffer.length
  );

  return res.send(buffer);
}

/* =========================================================
   GET /services
   MAGAZINELE VENDORULUI PENTRU SELECTORUL DE IMPORT

   IMPORTANT:
   această rută trebuie să fie înainte de GET /:importId
========================================================= */

router.get(
  getCatalogImportRoute("services"),
  async (req, res) => {
    try {
      const services =
        await prisma.vendorService.findMany({
          where: {
            vendorId: req.vendor.id,
          },

          orderBy: [
            {
              isActive: "desc",
            },
            {
              createdAt: "asc",
            },
          ],

          select: {
            id: true,
            title: true,
            isActive: true,
            createdAt: true,
          },
        });

      return res.json({
        services,

        requiresSelection:
          services.length > 1,

        defaultServiceId:
          services.length === 1
            ? services[0].id
            : null,
      });
    } catch (error) {
      console.error(
        "[catalog-import] services:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "services_load_failed",

          message:
            "Magazinele nu au putut fi încărcate.",
        });
    }
  }
);

/* =========================================================
   POST /upload
========================================================= */
router.post(
  getCatalogImportRoute("upload"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({
            error:
              "file_required",

            message:
              "Selectează un fișier pentru import.",
          });
      }

      const service =
        await resolveService({
          vendorId:
            req.vendor.id,

          serviceId:
            req.body
              ?.serviceId ||
            null,
        });

      const parsed =
        parseSpreadsheetBuffer({
          buffer:
            req.file.buffer,

          fileName:
            req.file.originalname,
        });

      const lowerName =
        String(
          req.file
            .originalname ||
            ""
        ).toLowerCase();

      const source =
        lowerName.endsWith(
          ".csv"
        )
          ? "CSV"
          : "EXCEL";

      const mapping =
        mappingFromColumns(
          parsed.columns
        );

      const createdImport =
        await prisma.$transaction(
          async (tx) => {
            const productImport =
              await tx.productImport.create({
                data: {
                  vendorId:
                    req.vendor.id,

                  serviceId:
                    service.id,

                  source,

                  status:
                    "MAPPING",

                  fileName:
                    req.file
                      .originalname,

                  fileSize:
                    req.file.size,

                  mimeType:
                    req.file
                      .mimetype ||
                    null,

                  columns:
                    parsed.columns,

                  mapping,

                  totalRows:
                    parsed.rows.length,

                  meta: {
                    sheetName:
                      parsed.sheetName,

                    uploadedByUserId:
                      req.authUser.id,
                  },

                  analyzedAt:
                    new Date(),
                },
              });

            await tx.productImportItem.createMany({
              data:
                parsed.rows.map(
                  (
                    row,
                    index
                  ) => ({
                    importId:
                      productImport.id,

                    /*
                     * Rând 1 =
                     * header Excel.
                     */
                    rowNumber:
                      index + 2,

                    rawData: row,

                    status:
                      "PENDING",
                  })
                ),
            });

            return productImport;
          }
        );

      return res.json({
        importId:
          createdImport.id,

        source,

        fileName:
          createdImport.fileName,

        service: {
          id: service.id,
          title:
            service.title,
        },

        totalRows:
          createdImport.totalRows,

        columns:
          parsed.columns,

        mapping,
      });
    } catch (error) {
      console.error(
        "[catalog-import] upload:",
        error
      );

      return res
        .status(
          error.statusCode ||
            400
        )
        .json({
          error:
            error.code ||
            "import_upload_failed",

          message:
            error.message ||
            "Fișierul nu a putut fi analizat.",
        });
    }
  }
);

/* =========================================================
   POST /:importId/preview
========================================================= */

router.post(
  getCatalogImportRoute("preview"),
  express.json(),
  async (req, res) => {
    try {
      const {
        importId,
      } = req.params;

      const productImport =
        await getOwnedImport({
          importId,

          vendorId:
            req.vendor.id,

          includeItems:
            true,
        });

      if (!productImport) {
        return res
          .status(404)
          .json({
            error:
              "import_not_found",
          });
      }

      const mapping =
        parseMapping(req.body) ||
        productImport.mapping;

      if (
        !mapping ||
        typeof mapping !==
          "object"
      ) {
        return res
          .status(400)
          .json({
            error:
              "mapping_required",

            message:
              "Mapping-ul coloanelor lipsește.",
          });
      }

      const hasTitle =
        Object.values(
          mapping
        ).includes("title");

      if (!hasTitle) {
        return res
          .status(400)
          .json({
            error:
              "title_mapping_required",

            message:
              "Trebuie să alegi o coloană pentru titlul produsului.",
          });
      }

      let readyRows = 0;
      let warningRows = 0;
      let failedRows = 0;

      const previewRows = [];

      await prisma.$transaction(
        async (tx) => {
          for (
            const item of
            productImport.items
          ) {
            if (
              item.status ===
              "SKIPPED"
            ) {
              continue;
            }

            const normalized =
              normalizeImportRow({
                rawData:
                  item.rawData,

                mapping,
              });

            const validation =
              validateNormalizedProduct(
                normalized
              );

            if (
              validation.status ===
              "READY"
            ) {
              readyRows += 1;
            } else if (
              validation.status ===
              "WARNING"
            ) {
              warningRows += 1;
            } else {
              failedRows += 1;
            }

            const updated =
              await tx.productImportItem.update({
                where: {
                  id: item.id,
                },

                data: {
                  normalizedData:
                    normalized,

                  status:
                    validation.status,

                  warnings:
                    validation.warnings,

                  errors:
                    validation.errors,
                },
              });

            previewRows.push(
              makePreviewRow(
                updated
              )
            );
          }

          await tx.productImport.update({
            where: {
              id:
                productImport.id,
            },

            data: {
              mapping,

              status:
                "PREVIEW_READY",

              readyRows,
              warningRows,
              failedRows,
            },
          });
        }
      );

      return res.json({
        importId:
          productImport.id,

        totalRows:
          productImport.items.length,

        readyRows,
        warningRows,
        failedRows,

        rows:
          previewRows,
      });
    } catch (error) {
      console.error(
        "[catalog-import] preview:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "import_preview_failed",

          message:
            error.message ||
            "Preview-ul nu a putut fi generat.",
        });
    }
  }
);

/* =========================================================
   POST /:importId/execute
========================================================= */

router.post(
  getCatalogImportRoute("execute"),
  express.json(),
  async (req, res) => {
    try {
      const {
        importId,
      } = req.params;

      const productImport =
        await getOwnedImport({
          importId,

          vendorId:
            req.vendor.id,

          includeItems:
            true,
        });

      if (!productImport) {
        return res
          .status(404)
          .json({
            error:
              "import_not_found",
          });
      }

      if (
        productImport.status !==
          "PREVIEW_READY" &&
        productImport.status !==
          "COMPLETED_WITH_ERRORS"
      ) {
        return res
          .status(409)
          .json({
            error:
              "preview_required",

            message:
              "Generează preview-ul înainte de import.",
          });
      }

      const itemsToImport =
        productImport.items.filter(
          (item) =>
            [
              "READY",
              "WARNING",
            ].includes(
              item.status
            ) &&
            !item.productId
        );

      if (
        !itemsToImport.length
      ) {
        return res
          .status(400)
          .json({
            error:
              "no_importable_products",

            message:
              "Nu există produse valide pentru import.",
          });
      }

      await prisma.productImport.update({
        where: {
          id:
            productImport.id,
        },

        data: {
          status:
            "IMPORTING",

          startedAt:
            new Date(),

          errorMessage:
            null,
        },
      });

      let importedNow = 0;
      let failedNow = 0;

      for (
        const item of
        itemsToImport
      ) {
        try {
          const productData =
            buildProductCreateData({
              normalizedData:
                item.normalizedData,

              serviceId:
                productImport.serviceId,
            });

          const createdProduct =
            await prisma.product.create({
              data:
                productData,
            });

          await prisma.productImportItem.update({
            where: {
              id: item.id,
            },

            data: {
              status:
                "IMPORTED",

              productId:
                createdProduct.id,

              importedAt:
                new Date(),

              errors: [],
            },
          });

          importedNow += 1;
        } catch (error) {
          console.error(
            `[catalog-import] row ${item.rowNumber}:`,
            error
          );

          failedNow += 1;

          await prisma.productImportItem.update({
            where: {
              id: item.id,
            },

            data: {
              status:
                "FAILED",

              errors: [
                error.message ||
                  "Produsul nu a putut fi creat.",
              ],
            },
          });
        }
      }

      const failedRows =
        await prisma.productImportItem.count({
          where: {
            importId:
              productImport.id,

            status: {
              in: [
                "ERROR",
                "FAILED",
              ],
            },
          },
        });

      const importedRows =
        await prisma.productImportItem.count({
          where: {
            importId:
              productImport.id,

            status:
              "IMPORTED",
          },
        });

      const skippedRows =
        await prisma.productImportItem.count({
          where: {
            importId:
              productImport.id,

            status:
              "SKIPPED",
          },
        });

      const finalStatus =
        failedRows > 0
          ? "COMPLETED_WITH_ERRORS"
          : "COMPLETED";

      const updatedImport =
        await prisma.productImport.update({
          where: {
            id:
              productImport.id,
          },

          data: {
            status:
              finalStatus,

            importedRows,
            failedRows,
            skippedRows,

            completedAt:
              new Date(),
          },
        });

      return res.json({
        importId:
          updatedImport.id,

        status:
          updatedImport.status,

        totalRows:
          updatedImport.totalRows,

        importedRows:
          updatedImport.importedRows,

        failedRows:
          updatedImport.failedRows,

        skippedRows:
          updatedImport.skippedRows,

        importedNow,
        failedNow,
      });
    } catch (error) {
      console.error(
        "[catalog-import] execute:",
        error
      );

      try {
        await prisma.productImport.updateMany({
          where: {
            id:
              req.params.importId,

            vendorId:
              req.vendor.id,
          },

          data: {
            status:
              "FAILED",

            errorMessage:
              error.message ||
              "Import nereușit.",

            completedAt:
              new Date(),
          },
        });
      } catch (
        updateError
      ) {
        console.error(
          "[catalog-import] failed status update:",
          updateError
        );
      }

      return res
        .status(500)
        .json({
          error:
            "import_execute_failed",

          message:
            error.message ||
            "Produsele nu au putut fi importate.",
        });
    }
  }
);

/* =========================================================
   POST /:importId/retry-failed
   REÎNCEARCĂ DOAR RÂNDURILE CARE AU EȘUAT
========================================================= */

router.post(
  getCatalogImportRoute("retryFailed"),
  express.json(),
  async (req, res) => {
    try {
      const {
        importId,
      } = req.params;

      const productImport =
        await getOwnedImport({
          importId,

          vendorId:
            req.vendor.id,

          includeItems:
            true,
        });

      if (!productImport) {
        return res
          .status(404)
          .json({
            error:
              "import_not_found",

            message:
              "Importul nu a fost găsit.",
          });
      }

      /*
       * Reîncercăm doar rândurile
       * FAILED care:
       *
       * - au normalizedData;
       * - nu au deja productId.
       */
      const failedItems =
        productImport.items.filter(
          (item) =>
            item.status ===
              "FAILED" &&
            !item.productId &&
            item.normalizedData
        );

      if (
        !failedItems.length
      ) {
        return res
          .status(400)
          .json({
            error:
              "no_failed_rows",

            message:
              "Nu există produse eșuate care să poată fi reîncercate.",
          });
      }

      /*
       * Marcăm importul ca fiind
       * din nou în procesare.
       */
      await prisma.productImport.update({
        where: {
          id:
            productImport.id,
        },

        data: {
          status:
            "IMPORTING",

          errorMessage:
            null,

          startedAt:
            productImport.startedAt ||
            new Date(),

          completedAt:
            null,
        },
      });

      let importedNow = 0;
      let failedNow = 0;

      for (
        const item of
        failedItems
      ) {
        try {
          const productData =
            buildProductCreateData({
              normalizedData:
                item.normalizedData,

              serviceId:
                productImport.serviceId,
            });

          const createdProduct =
            await prisma.product.create({
              data:
                productData,
            });

          await prisma.productImportItem.update({
            where: {
              id: item.id,
            },

            data: {
              status:
                "IMPORTED",

              productId:
                createdProduct.id,

              importedAt:
                new Date(),

              errors: [],
            },
          });

          importedNow += 1;
        } catch (error) {
          console.error(
            `[catalog-import] retry row ${item.rowNumber}:`,
            error
          );

          failedNow += 1;

          await prisma.productImportItem.update({
            where: {
              id: item.id,
            },

            data: {
              status:
                "FAILED",

              errors: [
                error.message ||
                  "Produsul nu a putut fi creat.",
              ],
            },
          });
        }
      }

      /*
       * Recalculăm statisticile
       * întregului import.
       */
      const importedRows =
        await prisma.productImportItem.count({
          where: {
            importId:
              productImport.id,

            status:
              "IMPORTED",
          },
        });

      const failedRows =
        await prisma.productImportItem.count({
          where: {
            importId:
              productImport.id,

            status: {
              in: [
                "ERROR",
                "FAILED",
              ],
            },
          },
        });

      const skippedRows =
        await prisma.productImportItem.count({
          where: {
            importId:
              productImport.id,

            status:
              "SKIPPED",
          },
        });

      const warningRows =
        await prisma.productImportItem.count({
          where: {
            importId:
              productImport.id,

            status:
              "WARNING",
          },
        });

      const readyRows =
        await prisma.productImportItem.count({
          where: {
            importId:
              productImport.id,

            status:
              "READY",
          },
        });

      const finalStatus =
        failedRows > 0
          ? "COMPLETED_WITH_ERRORS"
          : "COMPLETED";

      const updatedImport =
        await prisma.productImport.update({
          where: {
            id:
              productImport.id,
          },

          data: {
            status:
              finalStatus,

            importedRows,
            failedRows,
            skippedRows,
            warningRows,
            readyRows,

            completedAt:
              new Date(),
          },
        });

      return res.json({
        importId:
          updatedImport.id,

        status:
          updatedImport.status,

        totalRows:
          updatedImport.totalRows,

        importedRows:
          updatedImport.importedRows,

        failedRows:
          updatedImport.failedRows,

        skippedRows:
          updatedImport.skippedRows,

        importedNow,
        failedNow,
      });
    } catch (error) {
      console.error(
        "[catalog-import] retry failed:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "retry_failed_rows_failed",

          message:
            error.message ||
            "Produsele eșuate nu au putut fi reîncercate.",
        });
    }
  }
);

/* =========================================================
   GET /
   ISTORIC IMPORTURI
========================================================= */

router.get(
  getCatalogImportRoute("history"),
  async (req, res) => {
    try {
      const imports =
        await prisma.productImport.findMany({
          where: {
            vendorId:
              req.vendor.id,
          },

          orderBy: {
            createdAt:
              "desc",
          },

          take: 50,

          select: {
            id: true,
            serviceId: true,

            source: true,
            fileName: true,
            status: true,

            totalRows: true,
            readyRows: true,
            warningRows: true,
            failedRows: true,
            importedRows: true,
            skippedRows: true,

            createdAt: true,
            analyzedAt: true,
            startedAt: true,
            completedAt: true,

            errorMessage: true,

            service: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        });

      return res.json({
        imports,
      });
    } catch (error) {
      console.error(
        "[catalog-import] history:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "import_history_failed",
        });
    }
  }
);

/* =========================================================
   GET /template
   MODEL EXCEL PENTRU IMPORT

   IMPORTANT:
   ruta trebuie să fie înainte de /:importId
========================================================= */

router.get(
  getCatalogImportRoute("template"),
  async (req, res) => {
    try {
      const workbook =
        XLSX.utils.book_new();

      /* =====================================================
         SHEET 1 — PRODUSE
      ===================================================== */

      const productRows = [
        {
          title: "Cană ceramică",

          description:
            "Cană ceramică realizată manual.",

          price: 45,

          stock: 10,

          category: "Cadouri",

          image:
            "https://exemplu.ro/cana-principala.jpg",

          images:
            "https://exemplu.ro/cana-2.jpg | https://exemplu.ro/cana-3.jpg",

          availability: "READY",

          orderMode: "DIRECT",

          color: "Alb",

          materialMain:
            "Ceramică",

          dimensions:
            "300 ml",

          leadTimeDays: 2,

          isActive: true,
        },

        {
          title:
            "Odorizant dulap",

          description:
            "Odorizant decorativ parfumat realizat manual.",

          price: 35,

          stock: 5,

          category: "Casă",

          image:
            "https://exemplu.ro/odorizant.jpg",

          images: "",

          availability:
            "READY",

          orderMode:
            "DIRECT",

          color: "Roz",

          materialMain:
            "Ceară parfumată",

          dimensions:
            "8 x 5 cm",

          leadTimeDays: 2,

          isActive: true,
        },

        {
          title:
            "Lumânare realizată la comandă",

          description:
            "Lumânare realizată după plasarea comenzii.",

          price: 55,

          stock: 0,

          category:
            "Lumânări",

          image: "",

images: "",

          availability:
            "MADE_TO_ORDER",

          orderMode:
            "DIRECT",

          color:
            "Crem",

          materialMain:
            "Ceară de soia",

          dimensions:
            "200 ml",

          leadTimeDays: 5,

          isActive: true,
        },
      ];

      const productsSheet =
        XLSX.utils.json_to_sheet(
          productRows
        );

      setColumnWidths(
        productsSheet,
        [
          30, // title
          60, // description
          12, // price
          10, // stock
          22, // category
          50, // image
          70, // images
          22, // availability
          20, // orderMode
          18, // color
          24, // materialMain
          20, // dimensions
          18, // leadTimeDays
          12, // isActive
        ]
      );

      XLSX.utils.book_append_sheet(
        workbook,
        productsSheet,
        "Produse"
      );

      /* =====================================================
         SHEET 2 — INSTRUCȚIUNI
      ===================================================== */

      const instructions = [
        {
          Camp: "title",

          Obligatoriu: "DA",

          Descriere:
            "Numele produsului. Fiecare rând din sheet-ul Produse reprezintă un produs.",

          Exemplu:
            "Cană ceramică",
        },

        {
          Camp:
            "description",

          Obligatoriu: "NU",

          Descriere:
            "Descrierea produsului. Poate conține detalii despre produs, utilizare, materiale sau alte informații utile clientului.",

          Exemplu:
            "Cană ceramică realizată manual.",
        },

        {
          Camp: "price",

          Obligatoriu: "DA",

          Descriere:
            "Prețul produsului în lei. Poate fi scris ca număr întreg sau cu zecimale.",

          Exemplu:
            "45 sau 45,50",
        },

        {
          Camp: "stock",

          Obligatoriu: "NU",

          Descriere:
            "Cantitatea disponibilă imediat. Pentru produsele realizate la comandă poate fi 0.",

          Exemplu: "10",
        },

        {
          Camp: "category",

          Obligatoriu: "NU",

          Descriere:
            "Categoria în care se încadrează produsul.",

          Exemplu:
            "Cadouri",
        },

        {
  Camp: "image",

  Obligatoriu: "NU",

  Descriere:
    "Link public către imaginea principală a produsului. Folosește un link care începe cu http:// sau https://. Nu introduce adrese locale din calculator precum C:\\Users\\Ana\\Desktop\\poza.jpg, deoarece Artfest nu le poate accesa. Dacă nu ai un link public, lasă câmpul gol.",

  Exemplu:
    "https://siteulmeu.ro/imagini/cana-1.jpg",
},

{
  Camp: "images",

  Obligatoriu: "NU",

  Descriere:
    "Linkuri publice către imaginile suplimentare ale produsului. Dacă ai mai multe imagini, separă linkurile prin caracterul |. Produsul poate fi importat și fără imagini, caz în care poți lăsa câmpul gol.",

  Exemplu:
    "https://siteulmeu.ro/cana-2.jpg | https://siteulmeu.ro/cana-3.jpg",
},

        {
          Camp:
            "availability",

          Obligatoriu: "NU",

          Descriere:
            "Disponibilitatea produsului. Valorile acceptate sunt READY, MADE_TO_ORDER, PREORDER și SOLD_OUT.",

          Exemplu:
            "READY",
        },

        {
          Camp:
            "orderMode",

          Obligatoriu: "NU",

          Descriere:
            "Modul în care clientul poate comanda produsul. Valorile disponibile sunt DIRECT, OPTIONS, CUSTOMIZABLE și QUOTE_ONLY.",

          Exemplu:
            "DIRECT",
        },

        {
          Camp: "color",

          Obligatoriu: "NU",

          Descriere:
            "Culoarea principală a produsului.",

          Exemplu: "Alb",
        },

        {
          Camp:
            "materialMain",

          Obligatoriu: "NU",

          Descriere:
            "Materialul principal din care este realizat produsul.",

          Exemplu:
            "Ceramică",
        },

        {
          Camp:
            "dimensions",

          Obligatoriu: "NU",

          Descriere:
            "Dimensiunile produsului. Poate fi text liber.",

          Exemplu:
            "20 x 15 cm",
        },

        {
          Camp:
            "leadTimeDays",

          Obligatoriu: "NU",

          Descriere:
            "Numărul estimat de zile necesare până când produsul poate fi expediat. Este util mai ales pentru produsele realizate la comandă.",

          Exemplu: "3",
        },

        {
          Camp:
            "isActive",

          Obligatoriu: "NU",

          Descriere:
            "Stabilește dacă produsul va fi activ. Se poate folosi TRUE/DA sau FALSE/NU.",

          Exemplu:
            "TRUE",
        },
      ];

      const instructionsSheet =
        XLSX.utils.json_to_sheet(
          instructions
        );

      setColumnWidths(
        instructionsSheet,
        [
          22, // Camp
          14, // Obligatoriu
          85, // Descriere
          55, // Exemplu
        ]
      );

      XLSX.utils.book_append_sheet(
        workbook,
        instructionsSheet,
        "Instrucțiuni"
      );

      /* =====================================================
   SHEET 3 — AJUTOR IMAGINI
===================================================== */

const imageHelpRows = [
  {
    Situatie:
      "Cum adaug imaginile în Excel?",

    CeFac:
      "În Excel nu se atașează fișiere JPG, PNG sau WEBP. Se introduc doar linkuri publice către imagini, care încep cu https://. Dacă ai pozele doar în telefon sau calculator, lasă câmpurile image și images goale și adaugă imaginile ulterior în Artfest.",

    Exemplu:
      "https://siteulmeu.ro/poze/produs.jpg",
  },

  {
    Situatie:
      "Am imaginea deja pe site sau magazin online",

    CeFac:
      "Copiază linkul public al imaginii și pune-l în coloana image.",

    Exemplu:
      "https://magazinulmeu.ro/produse/cana.jpg",
  },

  {
    Situatie:
      "Am mai multe imagini pentru același produs",

    CeFac:
      "Pune imaginea principală în coloana image, iar restul în images, separate prin caracterul |.",

    Exemplu:
      "https://site.ro/2.jpg | https://site.ro/3.jpg",
  },

  {
    Situatie:
      "Poza este doar în calculator sau telefon",

    CeFac:
      "Lasă coloanele image și images goale. Nu introduce C:\\Users\\... sau doar numele fișierului, deoarece Artfest nu poate accesa fișierele locale.",

    Exemplu: "",
  },

  {
    Situatie:
      "Am link Google Drive sau Dropbox",

    CeFac:
      "Folosește linkul doar dacă imaginea este publică și poate fi accesată fără autentificare. Dacă nu ești sigur, lasă câmpul gol.",

    Exemplu: "",
  },

  {
    Situatie:
      "Nu am imagini acum",

    CeFac:
      "Lasă image și images goale. Produsul poate fi importat și poți adăuga imaginile ulterior în Artfest.",

    Exemplu: "",
  },
  {
  Situatie:
    "Poza poate fi în orice folder?",

  CeFac:
    "Da. Folderul nu contează, atât timp cât imaginea are un link public https:// care poate fi deschis fără autentificare. Căile locale precum C:\\Users\\... nu pot fi folosite.",

  Exemplu:
    "https://siteulmeu.ro/produse/cani/cana-1.jpg",
},
];

const imageHelpSheet =
  XLSX.utils.json_to_sheet(
    imageHelpRows
  );

setColumnWidths(
  imageHelpSheet,
  [
    42, // Situație
    90, // Ce fac
    65, // Exemplu
  ]
);

XLSX.utils.book_append_sheet(
  workbook,
  imageHelpSheet,
  "Ajutor imagini"
);

      /* =====================================================
         SHEET 4 — VALORI ACCEPTATE
      ===================================================== */

      const acceptedValues =
        XLSX.utils.json_to_sheet([
          /* -------------------------
             AVAILABILITY
          ------------------------- */

          {
            Camp:
              "availability",

            Valoare:
              "READY",

            Explicatie:
              "Produs gata de livrare / disponibil imediat.",
          },

          {
            Camp:
              "availability",

            Valoare:
              "MADE_TO_ORDER",

            Explicatie:
              "Produs realizat după plasarea comenzii.",
          },

          {
            Camp:
              "availability",

            Valoare:
              "PREORDER",

            Explicatie:
              "Produs disponibil pentru precomandă.",
          },

          {
            Camp:
              "availability",

            Valoare:
              "SOLD_OUT",

            Explicatie:
              "Produs indisponibil sau cu stoc epuizat.",
          },

          /* -------------------------
             ORDER MODE
          ------------------------- */

          {
            Camp:
              "orderMode",

            Valoare:
              "DIRECT",

            Explicatie:
              "Produs care poate fi cumpărat direct.",
          },

          {
            Camp:
              "orderMode",

            Valoare:
              "OPTIONS",

            Explicatie:
              "Produs cu variante sau opțiuni din care clientul trebuie să aleagă.",
          },

          {
            Camp:
              "orderMode",

            Valoare:
              "CUSTOMIZABLE",

            Explicatie:
              "Produs personalizabil pentru care clientul completează informații suplimentare.",
          },

          {
            Camp:
              "orderMode",

            Valoare:
              "QUOTE_ONLY",

            Explicatie:
              "Produs pentru care clientul trimite o cerere de ofertă în loc să îl cumpere direct.",
          },

          /* -------------------------
             IS ACTIVE
          ------------------------- */

          {
            Camp:
              "isActive",

            Valoare:
              "TRUE / DA",

            Explicatie:
              "Produsul va fi activ.",
          },

          {
            Camp:
              "isActive",

            Valoare:
              "FALSE / NU",

            Explicatie:
              "Produsul va fi inactiv.",
          },
        ]);

      setColumnWidths(
        acceptedValues,
        [
          22, // Camp
          25, // Valoare
          70, // Explicație
        ]
      );

      XLSX.utils.book_append_sheet(
        workbook,
        acceptedValues,
        "Valori acceptate"
      );

      /* =====================================================
         GENERĂM FIȘIERUL
      ===================================================== */

      return sendWorkbook(
        res,
        workbook,
        "model-import-produse-artfest.xlsx"
      );
    } catch (error) {
      console.error(
        "[catalog-import] template:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "template_generation_failed",

          message:
            "Modelul Excel nu a putut fi generat.",
        });
    }
  }
);

/* =========================================================
   GET /export
   EXPORT CATALOG COMPLET

   IMPORTANT:
   și această rută trebuie înainte de /:importId
========================================================= */

router.get(
  getCatalogImportRoute("export"),
  async (req, res) => {
    try {
      const vendorId =
        req.vendor.id;

      const products =
        await prisma.product.findMany({
          where: {
            service: {
              vendorId,
            },
          },

          orderBy: {
            createdAt:
              "desc",
          },

          include: {
            service: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        });

      const rows =
        products.map(
          (product) => ({
            productId:
              product.id,

            serviceId:
              product.serviceId,

            magazin:
              product.service
                ?.title ||
              "",

            title:
              product.title ||
              "",

            description:
              product.description ||
              "",

            price:
              Number(
                product.priceCents ||
                  0
              ) / 100,

            currency:
              product.currency ||
              "RON",

            stock:
              product.readyQty ??
              0,

            category:
              product.category ||
              "",

            color:
              product.color ||
              "",

            availability:
              product.availability ||
              "",

            leadTimeDays:
              product.leadTimeDays ??
              "",

            acceptsCustom:
              product.acceptsCustom ??
              false,

            materialMain:
              product.materialMain ||
              "",

            dimensions:
              product.dimensions ||
              "",

            orderMode:
              product.orderMode ||
              "",

            isActive:
              product.isActive ??
              true,

            images:
              Array.isArray(
                product.images
              )
                ? product.images.join(
                    " | "
                  )
                : "",

            styleTags:
              Array.isArray(
                product.styleTags
              )
                ? product.styleTags.join(
                    " | "
                  )
                : "",

            occasionTags:
              Array.isArray(
                product.occasionTags
              )
                ? product.occasionTags.join(
                    " | "
                  )
                : "",

            optionsSchema:
              jsonCell(
                product.optionsSchema
              ),

            customSchema:
              jsonCell(
                product.customSchema
              ),

            repeatedGroups:
              jsonCell(
                product.repeatedGroups
              ),

            quoteSchema:
              jsonCell(
                product.quoteSchema
              ),

            createdAt:
              dateCell(
                product.createdAt
              ),

            updatedAt:
              dateCell(
                product.updatedAt
              ),
          })
        );

      const workbook =
        XLSX.utils.book_new();

      const headers = [
        "productId",
        "serviceId",
        "magazin",
        "title",
        "description",
        "price",
        "currency",
        "stock",
        "category",
        "color",
        "availability",
        "leadTimeDays",
        "acceptsCustom",
        "materialMain",
        "dimensions",
        "orderMode",
        "isActive",
        "images",
        "styleTags",
        "occasionTags",
        "optionsSchema",
        "customSchema",
        "repeatedGroups",
        "quoteSchema",
        "createdAt",
        "updatedAt",
      ];

      const worksheet =
        rows.length
          ? XLSX.utils.json_to_sheet(
              rows,
              {
                header:
                  headers,
              }
            )
          : XLSX.utils.aoa_to_sheet([
              headers,
            ]);

      setColumnWidths(
        worksheet,
        [
          38, // productId
          38, // serviceId
          28, // magazin
          34, // title
          65, // description
          12, // price
          10, // currency
          10, // stock
          22, // category
          18, // color
          22, // availability
          18, // lead time
          16, // accepts custom
          24, // material
          22, // dimensions
          20, // orderMode
          12, // active
          80, // images
          40, // style tags
          40, // occasion tags
          90, // options
          90, // custom
          90, // repeated
          90, // quote
          26, // created
          26, // updated
        ]
      );

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Catalog produse"
      );

      /* =========================
         SHEET INFO
      ========================= */

      const infoSheet =
        XLSX.utils.json_to_sheet([
          {
            Camp:
              "Produse exportate",

            Valoare:
              products.length,
          },

          {
            Camp:
              "Data exportului",

            Valoare:
              new Date().toLocaleString(
                "ro-RO"
              ),
          },

          {
            Camp:
              "Observație",

            Valoare:
              "Câmpurile optionsSchema, customSchema, repeatedGroups și quoteSchema sunt exportate ca JSON pentru a păstra toate informațiile.",
          },
        ]);

      setColumnWidths(
        infoSheet,
        [
          25,
          100,
        ]
      );

      XLSX.utils.book_append_sheet(
        workbook,
        infoSheet,
        "Info"
      );

      const vendorName =
        safeFileName(
          req.vendor.id
        );

      const today =
        new Date()
          .toISOString()
          .slice(0, 10);

      return sendWorkbook(
        res,
        workbook,
        `catalog-artfest-${vendorName}-${today}.xlsx`
      );
    } catch (error) {
      console.error(
        "[catalog-import] export:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "catalog_export_failed",

          message:
            "Catalogul nu a putut fi exportat.",
        });
    }
  }
);

/* =========================================================
   GET /:importId/errors.xlsx
   DESCARCĂ RAPORTUL CU RÂNDURILE PROBLEMATICE

   IMPORTANT:
   această rută trebuie să fie înainte de GET /:importId
========================================================= */

router.get(
  getCatalogImportRoute("errorsReport"),
  async (req, res) => {
    try {
      const productImport =
        await getOwnedImport({
          importId:
            req.params.importId,

          vendorId:
            req.vendor.id,

          includeItems:
            true,
        });

      if (!productImport) {
        return res
          .status(404)
          .json({
            error:
              "import_not_found",

            message:
              "Importul nu a fost găsit.",
          });
      }

      const problemItems =
        productImport.items.filter(
          (item) =>
            [
              "WARNING",
              "ERROR",
              "FAILED",
            ].includes(
              item.status
            )
        );

      if (
        !problemItems.length
      ) {
        return res
          .status(404)
          .json({
            error:
              "no_problem_rows",

            message:
              "Acest import nu are rânduri cu avertismente sau erori.",
          });
      }

      const rows =
        problemItems.map(
          (item) => {
            const normalized =
              item.normalizedData ||
              {};

            return {
              rowNumber:
                item.rowNumber,

              status:
                item.status,

              title:
                normalized.title ||
                "",

              price:
                normalized.price ??
                (
                  normalized.priceCents !==
                    null &&
                  normalized.priceCents !==
                    undefined
                    ? Number(
                        normalized.priceCents
                      ) / 100
                    : ""
                ),

              category:
                normalized.category ||
                "",

              orderMode:
                normalized.orderMode ||
                "",

              availability:
                normalized.availability ||
                "",

              warnings:
                Array.isArray(
                  item.warnings
                )
                  ? item.warnings.join(
                      " | "
                    )
                  : "",

              errors:
                Array.isArray(
                  item.errors
                )
                  ? item.errors.join(
                      " | "
                    )
                  : "",

              rawData:
                jsonCell(
                  item.rawData
                ),

              normalizedData:
                jsonCell(
                  item.normalizedData
                ),
            };
          }
        );

      const workbook =
        XLSX.utils.book_new();

      const worksheet =
        XLSX.utils.json_to_sheet(
          rows
        );

      setColumnWidths(
        worksheet,
        [
          12,  // rowNumber
          18,  // status
          34,  // title
          12,  // price
          24,  // category
          20,  // orderMode
          22,  // availability
          70,  // warnings
          70,  // errors
          100, // rawData
          100, // normalizedData
        ]
      );

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Probleme import"
      );

      /*
       * Adăugăm și un sheet
       * cu informații generale.
       */
      const infoSheet =
        XLSX.utils.json_to_sheet([
          {
            Camp:
              "Fișier importat",

            Valoare:
              productImport.fileName ||
              "",
          },

          {
            Camp:
              "Rânduri cu probleme",

            Valoare:
              problemItems.length,
          },

          {
            Camp:
              "Data raportului",

            Valoare:
              new Date().toLocaleString(
                "ro-RO"
              ),
          },
        ]);

      setColumnWidths(
        infoSheet,
        [
          28,
          80,
        ]
      );

      XLSX.utils.book_append_sheet(
        workbook,
        infoSheet,
        "Info"
      );

      const baseName =
        safeFileName(
          productImport.fileName ||
          "import"
        );

      return sendWorkbook(
        res,
        workbook,
        `raport-erori-${baseName}.xlsx`
      );
    } catch (error) {
      console.error(
        "[catalog-import] errors report:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "errors_report_failed",

          message:
            "Raportul de erori nu a putut fi generat.",
        });
    }
  }
);

/* =========================================================
   GET /:importId
   DETALII IMPORT

   ATENȚIE:
   trebuie să rămână DUPĂ /template și /export
========================================================= */

router.get(
  getCatalogImportRoute("detail"),
  async (req, res) => {
    try {
      const productImport =
        await prisma.productImport.findFirst({
          where: {
            id:
              req.params.importId,

            vendorId:
              req.vendor.id,
          },

          include: {
            service: {
              select: {
                id: true,
                title: true,
              },
            },

            items: {
              orderBy: {
                rowNumber:
                  "asc",
              },

              select: {
                id: true,
                rowNumber: true,
                rawData: true,
                normalizedData:
                  true,
                status: true,
                warnings: true,
                errors: true,
                productId: true,
                importedAt: true,
              },
            },
          },
        });

      if (!productImport) {
        return res
          .status(404)
          .json({
            error:
              "import_not_found",
          });
      }

      return res.json({
        import:
          productImport,

        rows:
          productImport.items.map(
            makePreviewRow
          ),
      });
    } catch (error) {
      console.error(
        "[catalog-import] detail:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "import_detail_failed",
        });
    }
  }
);

/* =========================================================
   PATCH /:importId/items/:itemId/skip
========================================================= */

router.patch(
  getCatalogImportRoute("skipItem"),
  express.json(),
  async (req, res) => {
    try {
      const productImport =
        await getOwnedImport({
          importId:
            req.params.importId,

          vendorId:
            req.vendor.id,
        });

      if (!productImport) {
        return res
          .status(404)
          .json({
            error:
              "import_not_found",
          });
      }

      const item =
        await prisma.productImportItem.findFirst({
          where: {
            id:
              req.params.itemId,

            importId:
              productImport.id,
          },
        });

      if (!item) {
        return res
          .status(404)
          .json({
            error:
              "import_item_not_found",
          });
      }

      if (item.productId) {
        return res
          .status(409)
          .json({
            error:
              "already_imported",

            message:
              "Produsul a fost deja importat.",
          });
      }

      const updated =
        await prisma.productImportItem.update({
          where: {
            id: item.id,
          },

          data: {
            status:
              "SKIPPED",
          },
        });

      return res.json({
        ok: true,
        item: updated,
      });
    } catch (error) {
      console.error(
        "[catalog-import] skip:",
        error
      );

      return res
        .status(500)
        .json({
          error:
            "import_skip_failed",
        });
    }
  }
);

/* =========================================================
   MULTER ERROR HANDLER
========================================================= */

router.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {
        return res
          .status(413)
          .json({
            error:
              "file_too_large",

            message:
              "Fișierul poate avea maximum 20 MB.",
          });
      }

      return res
        .status(400)
        .json({
          error:
            "upload_error",

          message:
            error.message,
        });
    }

    if (error) {
      console.error(
        "[catalog-import] middleware:",
        error
      );

      return res
        .status(400)
        .json({
          error:
            "upload_error",

          message:
            error.message ||
            "Fișierul nu a putut fi încărcat.",
        });
    }

    next();
  }
);

export default router;