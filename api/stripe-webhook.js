// /api/stripe-webhook.js
const Stripe = require('stripe');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const resend = new Resend(process.env.RESEND_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  // IMPORTANT: Vercel needs the raw body for signature verification
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await getRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session?.customer_details?.email || session?.customer_email;
    if (email) {
      try {
        // idempotent insert by session id
        const { data: existing } = await supabase
          .from('licenses')
          .select('license_key')
          .eq('stripe_session_id', session.id)
          .maybeSingle();

        let licenseKey = existing?.license_key;
        if (!licenseKey) {
          licenseKey = uuidv4();
          const { error: insertErr } = await supabase
            .from('licenses')
            .insert({
              email,
              license_key: licenseKey,
              stripe_session_id: session.id
            });
          if (insertErr) {
            // race: read back
            const { data: again } = await supabase
              .from('licenses')
              .select('license_key')
              .eq('stripe_session_id', session.id)
              .maybeSingle();
            licenseKey = again?.license_key || licenseKey;
          }
        }

        // Email (best effort)
        try {
          await resend.emails.send({
            from: process.env.LICENSE_FROM_EMAIL,
            to: email,
            subject: 'Your LinkSphinx Pro License',
            html: `
              <div style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif">
                <h2>Thanks for your purchase!</h2>
                <p>Your license key:</p>
                <pre style="padding:12px;background:#f5f5f5;border-radius:8px;font-size:16px">${licenseKey}</pre>
                <p>In the extension’s Options page, paste this key into the License field and press <b>Redeem</b>.</p>
              </div>
            `
          });
        } catch (_) { /* ignore */ }
      } catch (e) {
        console.error('Webhook handler error', e);
      }
    }
  }

  res.json({ received: true });
};

// ——— helpers ———
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Vercel config to keep raw body
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
