// /api/stripe-webhook.js
export const config = { api: { bodyParser: false } }; // needed for Stripe verification

import crypto from "crypto";
import { buffer } from "micro";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

const b64url = (buf) => Buffer.from(buf).toString("base64url");

function makeLicense({ email, paymentLinkId, priceId }) {
  const payload = {
    p: "linksphinx",           // product tag the verifier expects
    em: email,                 // buyer email
    iat: Date.now(),           // issued at
    ver: 1,                    // schema version
    plink: paymentLinkId || "",// optional: lock to a specific Payment Link
    price: priceId || ""       // optional: lock to a specific price
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", process.env.LICENSE_SIGNING_SECRET).update(payloadB64).digest());
  return `LSK1.${payloadB64}.${sig}`;
}

async function sendEmail({ to, license }) {
  // Use Resend (simple + you’ve used it before)
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) throw new Error("Missing RESEND_API_KEY");
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: process.env.LICENSE_FROM_EMAIL || "Licenses <licenses@yourdomain.com>",
      to: [to],
      subject: "Your LinkSphinx Pro License",
      // keep it simple; add your branding later
      html: `
        <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
          <h2>Thanks for supporting LinkSphinx!</h2>
          <p>Here is your Pro license key:</p>
          <pre style="background:#111;color:#0f0;padding:12px;border-radius:8px;font-size:16px">${license}</pre>
          <p>In the extension, go to Options → Import section → Paste the license → “Redeem”.</p>
          <hr>
          <small>Keep this email for your records.</small>
        </div>`
    })
  });
  if (!resp.ok) throw new Error("Email send failed");
}

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

      // Optional: fetch line items to capture price id
      const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ["line_items"] });
      const priceId = full?.line_items?.data?.[0]?.price?.id || "";
      const paymentLinkId = full?.payment_link || ""; // e.g. "plink_123"
      const email = full?.customer_details?.email || full?.customer_email;

      // Gate by payment link or price if you want extra safety
      const allowPlink = process.env.ALLOWED_PAYMENT_LINK_ID;
      const allowPrice = process.env.ALLOWED_PRICE_ID;
      if (allowPlink && paymentLinkId !== allowPlink) return res.status(200).end("Ignored: different plink");
      if (allowPrice && priceId !== allowPrice) return res.status(200).end("Ignored: different price");

      const license = makeLicense({ email, paymentLinkId, priceId });
      await sendEmail({ to: email, license });

      return res.status(200).end("ok");
    } catch (e) {
      console.error(e);
      return res.status(500).end("Internal error");
    }
  }

  return res.status(200).end("ignored");
}
