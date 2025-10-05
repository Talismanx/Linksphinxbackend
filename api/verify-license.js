// /api/verify-license.ts
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message:'Method not allowed' });
  const { license } = req.body || {};
  const trimmed = (license || '').trim();
  if (!trimmed) return res.json({ valid:false, message:'Missing license' });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data, error } = await supabase
    .from('licenses')
    .select('status, product')
    .eq('license_key', trimmed)
    .maybeSingle();

  if (error) return res.json({ valid:false, message:'Lookup error' });
  if (!data) return res.json({ valid:false, message:'Invalid license' });
  if (data.product !== 'linksphinx_pro') return res.json({ valid:false, message:'Wrong product' });
  if (data.status !== 'active') return res.json({ valid:false, message:'License not active' });

  return res.json({ valid:true });
}
