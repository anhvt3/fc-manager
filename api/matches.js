import { gsGet, gsPost } from './_lib/googleClient.js';

export default async function handler(req, res) {
  const method = req.method;
  const sheet = 'data.new.TranDau';
  
  try {
    if (method === 'GET') {
      const data = await gsGet(`read&sheet=${sheet}`);
      return res.status(200).json(data);
    } 
    else if (method === 'POST') {
      // Create new match: ['AUTO_TS', date, opponent, venue, result, cost, note]
      const { date, opponent, venue, result, cost, note } = req.body;
      const data = ['AUTO_TS', date, opponent, venue || '', result, cost || 0, note || ''];
      const resp = await gsPost({ action: 'create', sheet, data });
      return res.status(200).json(resp);
    }
    // Note: PUT and DELETE are not fully implemented in frontend yet for matches,
    // but we stub them for API completeness
    else if (method === 'PUT') {
      const { id, date, opponent, venue, result, cost, note } = req.body;
      // Giữ nguyên timestamp gốc — null ở col 1 sẽ skip update timestamp trong Code.gs
      const data = [null, date, opponent, venue, result, cost, note];
      const resp = await gsPost({ action: 'update', sheet, matchColumn: 1, matchValue: id, data });
      return res.status(200).json(resp);
    }
    else if (method === 'DELETE') {
      const id = req.query.id || req.body.id;
      const resp = await gsPost({ action: 'delete', sheet, matchColumn: 1, matchValue: id });
      return res.status(200).json(resp);
    }
    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    res.status(405).end(`Method ${method} Not Allowed`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
