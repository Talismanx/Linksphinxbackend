// /api/verify-license.js
import crypto from "crypto";

const ORIGIN = "*"; // or restrict to your site later
const PRODUCT = "linksphinx"; // required product tag inside license

// helpers
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const ub64url = (s) => Buffer.from(s, "base64url").toString("utf8");
const safeEq = (a, b) => {
  const A = Buffer.from(a); const B = Buffer.from(b);
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};

export default async function handler(req, res) {
  // CORS
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", ORIGIN);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  res.setHeader("Access-Control-Allow-Origin", ORIGIN);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { license } = req.body || {};
    if (typeof license !== "string" || !license.startsWith("LSK1.")) {
      return res.status(200).json({ valid: false, message: "Invalid license." });
    }

    const [, payloadB64, sigB64] = license.split(".");
    const secret = process.env.LICENSE_SIGNING_SECRET;
    if (!secret) {
      return res.status(500).json({ valid: false, message: "Server not configured." });
    }

    const wantSig = b64url(crypto.createHmac("sha256", secret).update(payloadB64).digest());
    if (!safeEq(wantSig, sigB64)) {
      return res.status(200).json({ valid: false, message: "Invalid signature." });
    }

    const payload = JSON.parse(ub64url(payloadB64));
    // payload = { p, em, iat, ver, plink?, price? }
    if (payload.p !== PRODUCT) {
      return res.status(200).json({ valid: false, message: "Wrong product." });
    }

    // Optional: lock to your Payment Link or price
    const allowedPlink = process.env.ALLOWED_PAYMENT_LINK_ID; // e.g., "plink_123"
    const allowedPrice = process.env.ALLOWED_PRICE_ID;        // e.g., "price_123"
    if (allowedPlink && payload.plink !== allowedPlink) {
      return res.status(200).json({ valid: false, message: "Not for this link." });
    }
    if (allowedPrice && payload.price !== allowedPrice) {
      return res.status(200).json({ valid: false, message: "Not for this price." });
    }

    // Lifetime license: no exp. If you want, you can add exp & check here.

    return res.status(200).json({ valid: true });
  } catch (e) {
    return res.status(200).json({ valid: false, message: "Invalid license." });
  }
}
