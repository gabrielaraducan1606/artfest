// /cerere - link scurt pentru QR: deschide formularul de cerere fără cont,
// păstrând parametrii din QR (utm_*, src). Vezi buildQrRequestTarget.

import React from "react";
import { Navigate, useLocation } from "react-router-dom";

import { buildQrRequestTarget } from "./guestRequestUtils.js";

export default function QrRequestRedirect() {
  const location = useLocation();
  return <Navigate to={buildQrRequestTarget(location.search)} replace />;
}
