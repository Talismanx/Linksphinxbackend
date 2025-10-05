// /api/stripe-webhook.js
export const config = { api: { bodyParser: false } };

import { buffer } from "micro";
import Stripe from "stripe";
import { makeLicense } from "../lib/license.js";
import { sendLicenseEmail } from "../lib/email.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const sig = req.headers["stripe-signature"];
  const rawBody = await buffer(req);
  let event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    try {
      const session = event.data.object;
      // Retrieve expanded data (line_items, created timestamp, etc)
      const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ["line_items"] });

      const priceId = full?.line_items?.data?.[0]?.price?.id || "";
      const paymentLinkId = full?.payment_link || "";
      const email = full?.customer_details?.email || full?.customer_email;

      // Optional hardening
      const allowPlink = process.env.ALLOWED_PAYMENT_LINK_ID;
      const allowPrice = process.env.ALLOWED_PRICE_ID;
      if (allowPlink && paymentLinkId !== allowPlink) return res.status(200).end("Ignored: plink mismatch");
      if (allowPrice && priceId !== allowPrice) return res.status(200).end("Ignored: price mismatch");

      // Deterministic iat so it equals the success page license
      const issuedAtMs = (full.created || Math.floor(Date.now()/1000)) * 1000;
      const license = makeLicense({ email, paymentLinkId, priceId, issuedAtMs });

      // Email via Resend
      await sendLicenseEmail({ to: email, license });

      return res.status(200).end("ok");
    } catch (e) {
      console.error("webhook error:", e);
      return res.status(500).end("Internal error");
    }
  }

  return res.status(200).end("ignored");
}
