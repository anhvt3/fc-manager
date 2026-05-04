import { gsGet, gsPost } from './_lib/googleClient.js';

export default async function handler(req, res) {
  const method = req.method;
  const sheet = 'data.new.ThanhVien';
  
  try {
    if (method === 'GET') {
      const data = await gsGet(`read&sheet=${sheet}`);
      return res.status(200).json(data);
    } 
    else if (method === 'POST') {
      // Create new member: ['AUTO_TS', name, role, number, size, status]
      const { name, role, number, size, status } = req.body;
      const data = ['AUTO_TS', name, role || 'Đi làm', number || 0, size || 'M', status || 'active'];
      const result = await gsPost({ action: 'create', sheet, data });
      return res.status(200).json(result);
    }
    else if (method === 'PUT') {
      // Update member — identify by original name in column 2.
      // Giữ nguyên timestamp gốc (col 1 = null) tránh thay đổi mỗi lần edit.
      const { origName, name, role, number, size, status } = req.body;
      const data = [null, name, role, number, size, status];
      const result = await gsPost({ action: 'update', sheet, matchColumn: 2, matchValue: origName, data });
      return res.status(200).json(result);
    }
    else if (method === 'DELETE') {
      // Delete member by name
      const origName = req.query.id || req.body.origName;
      if (!origName) return res.status(400).json({error: 'Missing origName / id'});
      const result = await gsPost({ action: 'delete', sheet, matchColumn: 2, matchValue: origName });
      return res.status(200).json(result);
    }
    res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
    res.status(405).end(`Method ${method} Not Allowed`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
