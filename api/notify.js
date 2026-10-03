// Vercel serverless function: POST /api/notify
// Sends one email via Resend (https://resend.com). No npm dependencies.
//
// Required env vars (Vercel -> Settings -> Environment Variables):
//   RESEND_API_KEY    your Resend API key
//   NOTIFY_FROM       e.g. "Document Control <doccontrol@yourcompany.com>" (domain verified in Resend)
//   NOTIFY_PASSWORD   shared password users type in the dashboard
// Optional:
//   ALLOWED_DOMAINS   comma list, e.g. "yourcompany.com,partner.com" – recipients outside are rejected
//   REPLY_TO          reply-to address

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function parseList(v) {
  return String(v || '').split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { RESEND_API_KEY, NOTIFY_FROM, NOTIFY_PASSWORD, ALLOWED_DOMAINS, REPLY_TO } = process.env;
  if (!RESEND_API_KEY || !NOTIFY_FROM || !NOTIFY_PASSWORD) {
    return res.status(500).json({ error: 'Server not configured (missing environment variables)' });
  }
  if (req.headers['x-notify-password'] !== NOTIFY_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const to = parseList(body.to), cc = parseList(body.cc);
  const subject = String(body.subject || '').slice(0, 300);
  const text = String(body.body || '').slice(0, 20000);
  const html = body.html ? String(body.html).slice(0, 100000) : undefined;

  if (!to.length || !subject || !text) return res.status(400).json({ error: 'to, subject and body are required' });
  if (to.length + cc.length > 20) return res.status(400).json({ error: 'Too many recipients' });
  const all = [...to, ...cc];
  if (!all.every(a => EMAIL_RE.test(a))) return res.status(400).json({ error: 'Invalid email address' });

  const allowed = parseList(ALLOWED_DOMAINS).map(d => d.toLowerCase());
  if (allowed.length && !all.every(a => allowed.includes(a.split('@')[1].toLowerCase()))) {
    return res.status(400).json({ error: 'Recipient domain not allowed' });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: NOTIFY_FROM, to, cc: cc.length ? cc : undefined,
        subject, text, html, reply_to: REPLY_TO || undefined
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: j.message || 'Email provider error' });
    return res.status(200).json({ ok: true, id: j.id });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach email provider' });
  }
};
