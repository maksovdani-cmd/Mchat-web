import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { requireAuth } from '../middleware/auth';
import { wrap } from '../utils/errors';

export const callsRouter = Router();
callsRouter.use(requireAuth);

/** Проверка, настроен ли Daily.co на сервере */
callsRouter.get('/status', wrap(async (_req, res) => {
  res.json({ enabled: Boolean(config.DAILY_API_KEY) });
}));

/** Создание или получение URL комнаты Daily.co */
callsRouter.post('/room', wrap(async (req, res) => {
  if (!config.DAILY_API_KEY) {
    return res.status(500).json({ error: 'daily_not_configured' });
  }

  const { roomName } = z.object({
    roomName: z.string().min(1).max(100).optional()
  }).parse(req.body);

  const name = roomName || `mchat-room-${Date.now()}`;

  const response = await fetch('https://api.daily.co/v1/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.DAILY_API_KEY}`,
    },
    body: JSON.stringify({
      name,
      properties: {
        exp: Math.floor(Date.now() / 1000) + 3600,
        enable_chat: false,
        enable_knocking: false,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok && data.error === 'invalid-request-error' && data.info?.includes('already exists')) {
    const getRes = await fetch(`https://api.daily.co/v1/rooms/${name}`, {
      headers: { Authorization: `Bearer ${config.DAILY_API_KEY}` },
    });
    const roomData = await getRes.json();
    return res.json({ url: roomData.url });
  }

  if (!response.ok) {
    console.error('Daily API Error:', data);
    return res.status(500).json({ error: 'failed_to_create_room' });
  }

  res.json({ url: data.url });
}));