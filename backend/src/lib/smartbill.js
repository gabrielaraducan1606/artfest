const SMARTBILL_BASE_URL = "https://ws.smartbill.ro/SBORO/api";

function smartBillAuthHeader() {
  const email = process.env.SMARTBILL_EMAIL;
  const token = process.env.SMARTBILL_TOKEN;

  if (!email || !token) {
    throw new Error("SMARTBILL_CREDENTIALS_MISSING");
  }

  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

function toDateOnly(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export async function createSmartBillInvoice({
  client,
  issueDate,
  dueDate,
  seriesName,
  currency = "RON",
  totalNet,
  vatRate = 21,
  description,
}) {
  const companyVatCode = process.env.SMARTBILL_COMPANY_VAT_CODE;

  if (!companyVatCode) {
    throw new Error("SMARTBILL_COMPANY_VAT_CODE_MISSING");
  }

  const payload = {
    companyVatCode,
    isDraft: false,
    issueDate: toDateOnly(issueDate),
    dueDate: toDateOnly(dueDate),
    seriesName,
    currency,
    language: "RO",
    useStock: false,
    client: {
      name: client.name,
      vatCode: client.vatCode || "",
      regCom: client.regCom || "",
      address: client.address || "",
      city: client.city || "",
      country: "Romania",
      email: client.email || "",
      isTaxPayer: Boolean(client.isTaxPayer),
      saveToDb: true,
    },
    products: [
      {
        name: description,
        code: "COMISION-PLATFORMA",
        measuringUnitName: "buc",
        currency,
        quantity: 1,
        price: Number(totalNet),
        isTaxIncluded: false,
        taxName: Number(vatRate) > 0 ? "Normala" : "Scutit",
taxPercentage: Number(vatRate || 0),
        isService: true,
        saveToDb: true,
      },
    ],
  };

  const res = await fetch(`${SMARTBILL_BASE_URL}/invoice`, {
    method: "POST",
    headers: {
      Authorization: smartBillAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data?.message || data?.errorText || "SMARTBILL_CREATE_FAILED");
    err.details = data;
    throw err;
  }

  return data;
}

export async function getSmartBillInvoicePdfBuffer({ seriesName, number }) {
  const companyVatCode = process.env.SMARTBILL_COMPANY_VAT_CODE;

  const url = new URL(`${SMARTBILL_BASE_URL}/invoice/pdf`);
  url.searchParams.set("cif", companyVatCode);
  url.searchParams.set("seriesname", seriesName);
  url.searchParams.set("number", number);

  const res = await fetch(url, {
    headers: {
      Authorization: smartBillAuthHeader(),
    },
  });

  if (!res.ok) {
    throw new Error("SMARTBILL_PDF_FAILED");
  }

  return Buffer.from(await res.arrayBuffer());
}