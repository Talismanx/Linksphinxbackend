// /lib/email.js
export async function sendLicenseEmail({ to, license }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) throw new Error("Missing RESEND_API_KEY");
  const from = process.env.LICENSE_FROM_EMAIL || "LinkSphinx <no-reply@yourdomain.com>";

  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
      <h2>Thanks for supporting LinkSphinx 🎉</h2>
      <p>Here is your <strong>LinkSphinx Pro</strong> license key:</p>
      <pre style="background:#0b1220;color:#66ff66;padding:14px;border-radius:10px;font-size:16px">${license}</pre>
      <p>In the extension, open <em>Options → Import</em>, paste the key, and press <strong>Redeem</strong>.</p>
      <hr>
      <small>Keep this email for your records.</small>
    </div>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from, to: [to], subject: "Your LinkSphinx Pro License", html
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Resend failed: ${res.status} ${txt}`);
  }
}
