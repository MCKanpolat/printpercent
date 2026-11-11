import { json } from './http.mjs';

function percentage(value, scale = 1) {
  if (typeof value === 'string' && value.trim()) value = Number(value);
  if (!Number.isFinite(value) || value < 0 || value > 100 / scale) {
    throw new Error('Geçerli baskı yüzdesi alınamadı');
  }
  return Math.round(value * scale);
}

export async function moonrakerProgress(base, key) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/printer/objects/query`;
  url.search = 'print_stats=state&display_status=progress&virtual_sdcard=progress';
  const body = await json(url, { headers: key ? { 'X-Api-Key': key } : {} });
  const status = body.result?.status;
  switch (status?.print_stats?.state) {
    case 'complete':
      return 100;
    case 'standby':
    case 'cancelled':
      return 0;
    case 'printing':
    case 'paused':
    case 'error':
      return percentage(status.display_status?.progress ?? status.virtual_sdcard?.progress, 100);
    default:
      throw new Error('Moonraker baskı durumu alınamadı');
  }
}

export function crealityProgress(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => finish(new Error('WebSocket zaman aşımı')), 5000);
    let settled = false;
    let state;
    let progress;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(value);
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ method: 'get', params: { deviceState: 1, printProgress: 1 } }));
    });
    socket.addEventListener('error', () => finish(new Error('WebSocket bağlantı hatası')));
    socket.addEventListener('close', () => finish(new Error('WebSocket bağlantısı kapandı')));
    socket.addEventListener('message', ({ data }) => {
      if (data === 'heart_beat') {
        if (socket.readyState === WebSocket.OPEN) socket.send('ok');
        return;
      }
      try {
        const update = JSON.parse(data);
        if (update?.deviceState != null) state = String(update.deviceState);
        if (update?.printProgress != null) progress = update.printProgress;
      } catch {
        return;
      }
      try {
        if (state === undefined || progress === undefined) return;
        const value = percentage(progress);
        finish(null, state === '0' && value < 100 ? 0 : value);
      } catch (error) {
        finish(error);
      }
    });
  });
}
