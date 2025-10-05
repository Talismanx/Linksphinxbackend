// /lib/license.js
import crypto from "crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const ub64url = (s) => Buffer.from(s, "base64url").toString("utf8");

export function makeLicense({ email, paymentLinkId, priceId, issuedAtMs }) {
  const payload = {
    p: "linksphinx",
    em: email || "",
    iat: issuedAtMs || Date.now(),
    ver: 1,
    plink: paymentLinkId || "",
    price: priceId || ""
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = b64url(
    crypto.createHmac("sha256", process.env.LICENSE_SIGNING_SECRET)
      .update(payloadB64).digest()
  );
  return `LSK1.${payloadB64}.${sig}`;
}

export function verifyLicense(license) {
  if (typeof license !== "string" || !license.startsWith("LSK1.")) {
    return { valid: false, reason: "format" };
  }
  const [, payloadB64, sigB64] = license.split(".");
  const wantSig = b64url(crypto.createHmac("sha256", process.env.LICENSE_SIGNING_SECRET).update(payloadB64).digest());
  const valid = crypto.timingSafeEqual(Buffer.from(wantSig), Buffer.from(sigB64));
  if (!valid) return { valid: false, reason: "sig" };
  const payload = JSON.parse(ub64url(payloadB64));
  if (payload.p !== "linksphinx") return { valid: false, reason: "product" };
  const allowedPlink = process.env.ALLOWED_PAYMENT_LINK_ID;
  const allowedPrice = process.env.ALLOWED_PRICE_ID;
  if (allowedPlink && payload.plink !== allowedPlink) return { valid: false, reason: "plink" };
  if (allowedPrice && payload.price !== allowedPrice) return { valid: false, reason: "price" };
  return { valid: true, payload };
}
