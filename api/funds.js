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
      const data = ['AUTO_TS', period, member, amount || 0, note || ''];
      const resp = await gsPost({ action: 'create', sheet, data });
      return res.status(200).json(resp);
    }
    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${method} Not Allowed`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
