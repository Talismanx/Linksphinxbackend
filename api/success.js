// /api/success.ts
import Stripe from 'stripe';
import { Resend } from 'resend';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const resend = new Resend(process.env.RESEND_API_KEY!);

function makeKey() {
  const chunk = () => crypto.randomBytes(4).toString('hex').toUpperCase();
  return `LS-${chunk()}-${chunk()}-${chunk()}`;
}

export default async function handler(req, res) {
  const session_id = req.query.session_id as string;
  if (!session_id) return res.status(400).send('Missing session_id');

  const sess = await stripe.checkout.sessions.retrieve(session_id);
  if (!sess || sess.payment_status !== 'paid') {
    return res.status(400).send('Payment not verified.');
  }

  const email = sess.customer_details?.email || '';
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // avoid duplicate mint on refresh
  const { data: existing } = await supabase
    .from('licenses')
    .select('license_key')
    .eq('checkout_session_id', session_id)
    .maybeSingle();

  const license = existing?.license_key || makeKey();

  if (!existing) {
    const { error } = await supabase.from('licenses').insert({
      product: 'linksphinx_pro',
      license_key: license,
      status: 'active',
      email,
      checkout_session_id: session_id
    });
    if (error) return res.status(500).send('Failed to store license.');
  }

  // email (optional but recommended)
  if (email) {
    try {
      await resend.emails.send({
        from: process.env.LICENSE_FROM_EMAIL!,          // e.g. "LinkSphinx <licenses@linksphinx.app>"
        to: email,
        subject: 'Your LinkSphinx Pro License',
        html: `
          <p>Thanks for your purchase!</p>
          <p><b>Your license key:</b> <code>${license}</code></p>
          <p>In the extension, open Options → “Have a license?” → Paste → Redeem.</p>
        `
      });
    } catch { /* non-fatal */ }
  }

  // Simple success page with copy friendly key
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`
    <!doctype html><meta charset="utf-8">
    <title>LinkSphinx — Success</title>
    <style>body{font:16px system-ui;margin:40px;max-width:700px}code{background:#eee;padding:2px 6px;border-radius:6px}</style>
    <h1>Thanks! Your LinkSphinx Pro license</h1>
    <p>License key: <code id="k">${license}</code></p>
    <p>Open the extension’s Options page, click <i>Have a license?</i>, paste the key, and press <b>Redeem</b>.</p>
    <button onclick="navigator.clipboard.writeText(document.getElementById('k').textContent)">Copy key</button>
  `);
}
