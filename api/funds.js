import { gsGet, gsPost } from './_lib/googleClient.js';

export default async function handler(req, res) {
  const method = req.method;
  const sheet = 'data.new.DongQuy';

  try {
    if (method === 'GET') {
      const data = await gsGet(`read&sheet=${sheet}`);
      return res.status(200).json(data);
    }
    else if (method === 'POST') {
      // Create new fund: ['AUTO_TS', period, member, amount, note]
      const { period, member, amount, note } = req.body;
      if (!period || !member) return res.status(400).json({ error: 'Missing period or member' });
      const data = ['AUTO_TS', period, member, amount || 0, note || ''];
      const resp = await gsPost({ action: 'create', sheet, data });
      return res.status(200).json(resp);
    }
    else if (method === 'PUT') {
      // Upsert by composite (period, member). Apps Script handles match across 2 columns.
      const { period, member, amount, note } = req.body;
      if (!period || !member) return res.status(400).json({ error: 'Missing period or member' });
      const data = ['AUTO_TS', period, member, amount || 0, note || ''];
      const resp = await gsPost({
        action: 'upsert',
        sheet,
        matchColumns: [2, 3],          // period at col 2, member at col 3
        matchValues: [period, member],
        data
      });
      return res.status(200).json(resp);
    }
    else if (method === 'DELETE') {
      const { period, member } = req.body || {};
      if (!period || !member) return res.status(400).json({ error: 'Missing period or member' });
      const resp = await gsPost({
        action: 'deleteComposite',
        sheet,
        matchColumns: [2, 3],
        matchValues: [period, member]
      });
      return res.status(200).json(resp);
    }
    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    res.status(405).end(`Method ${method} Not Allowed`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
