import { gsGet } from './_lib/googleClient.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const data = await gsGet('getAll');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.status(200).json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  } else {
    res.setHeader('Allow', ['GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
