// /api/resend-license.js
import Stripe from "stripe";
import { verifyLicense, makeLicense } from "../lib/license.js";
import { sendLicenseEmail } from "../lib/email.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const allowOrigin = "*"; // or lock this to your sites later

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { license, session_id, to } = req.body || {};

    // Case A: user supplies an existing license → verify and email it
    if (license) {
      const v = verifyLicense(license);
      if (!v.valid) return res.status(400).json({ ok: false, error: "Invalid license" });
      const email = to || v.payload.em;
      if (!email) return res.status(400).json({ ok: false, error: "Missing email" });
      await sendLicenseEmail({ to: email, license });
      return res.status(200).json({ ok: true, sent: true });
    }

    // Case B: user supplies a Checkout Session ID → rebuild license deterministically and email
    if (session_id) {
      const full = await stripe.checkout.sessions.retrieve(session_id, { expand: ["line_items"] });
      if (full.payment_status !== "paid") return res.status(400).json({ ok: false, error: "Unpaid session" });

      const priceId = full?.line_items?.data?.[0]?.price?.id || "";
      const paymentLinkId = full?.payment_link || "";
      const email = to || full?.customer_details?.email || full?.customer_email;

      if (!email) return res.status(400).json({ ok: false, error: "Missing email" });

      const allowPlink = process.env.ALLOWED_PAYMENT_LINK_ID;
      const allowPrice = process.env.ALLOWED_PRICE_ID;
      if (allowPlink && paymentLinkId !== allowPlink) return res.status(403).json({ ok: false, error: "plink mismatch" });
      if (allowPrice && priceId !== allowPrice) return res.status(403).json({ ok: false, error: "price mismatch" });

      const issuedAtMs = (full.created || Math.floor(Date.now()/1000)) * 1000;
      const lic = makeLicense({ email, paymentLinkId, priceId, issuedAtMs });

      await sendLicenseEmail({ to: email, license: lic });
      return res.status(200).json({ ok: true, sent: true });
    }

    return res.status(400).json({ ok: false, error: "Provide license or session_id" });
  } catch (e) {
    console.error("resend-license error:", e);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}
