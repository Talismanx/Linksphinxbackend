import crypto from "crypto";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
const b64url = (buf) => Buffer.from(buf).toString("base64url");

function makeLicense({ email, paymentLinkId, priceId, issuedAtMs }) {
  const payload = {
    p: "linksphinx",
    em: email || "",
    iat: issuedAtMs,    // deterministic issue time
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

export default async function handler(req, res) {
  try {
    const id = (req.query.session_id || "").toString();
    if (!id) return res.status(400).send("Missing session_id");

    const session = await stripe.checkout.sessions.retrieve(id, { expand: ["line_items"] });
    if (session.payment_status !== "paid") return res.status(400).send("Payment not completed.");

    const paymentLinkId = session.payment_link || "";
    const priceId = session?.line_items?.data?.[0]?.price?.id || "";
    const email = session?.customer_details?.email || session?.customer_email || "";

    // Optional hardening
    const allowPlink = process.env.ALLOWED_PAYMENT_LINK_ID;
    const allowPrice = process.env.ALLOWED_PRICE_ID;
    if (allowPlink && paymentLinkId !== allowPlink) return res.status(403).send("Invalid Payment Link");
    if (allowPrice && priceId !== allowPrice) return res.status(403).send("Invalid Price");

    // Deterministic iat (so webhook + this page produce the SAME key)
    const license = makeLicense({
      email, paymentLinkId, priceId,
      issuedAtMs: (session.created || Math.floor(Date.now()/1000)) * 1000
    });

    // Simple HTML success page
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        body { font: 16px system-ui, -apple-system, Segoe UI, Roboto, Arial; background:#0b1220; color:#e8eef9; display:grid; place-items:center; min-height:100vh; margin:0; }
        main { width:min(780px, 92%); background:#121a2b; border:1px solid #24324a; border-radius:14px; padding:22px; box-shadow:0 10px 40px rgba(0,0,0,.4) }
        h1 { margin:0 0 6px; font-size:22px }
        .muted{ color:#9bb0d0 }
        pre { background:#0d1423; color:#5de35d; padding:14px; border-radius:10px; overflow:auto }
        .row{ display:flex; gap:10px; flex-wrap:wrap; align-items:center }
        button { padding:10px 14px; border-radius:10px; border:1px solid #284a28; background:#183818; color:#d6ffd6; cursor:pointer }
        a.btn { padding:10px 14px; border-radius:10px; border:1px solid #2c3f63; background:#172643; color:#e8eef9; text-decoration:none }
      </style>
      <main>
        <h1>Thanks for supporting LinkSphinx 🎉</h1>
        <p class="muted">Here’s your Pro license key. Paste it on the Options page → Import section → “Redeem”.</p>
        <pre id="key">${license}</pre>
        <div class="row">
          <button onclick="navigator.clipboard.writeText(document.getElementById('key').innerText)">Copy license</button>
          <a class="btn" href="https://linksphinx.vercel.app" target="_blank" rel="noopener">Open LinkSphinx</a>
        </div>
        <p class="muted" style="margin-top:10px">Purchased for: ${email || "—"}</p>
      </main>
    `);
  } catch (e) {
    res.status(500).send("Error rendering success page.");
  }
}
