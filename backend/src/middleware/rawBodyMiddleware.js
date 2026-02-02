import bodyParser from "body-parser";

export const stripeRawBody = bodyParser.raw({
  type: "application/json",
});
