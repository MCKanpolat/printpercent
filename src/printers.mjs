import { json } from './http.mjs';

function percentage(value, scale = 1) {
  if (typeof value === 'string' && value.trim()) value = Number(value);
  if (!Number.isFinite(value) || value < 0 || value > 100 / scale) {
    throw new Error('Invalid print progress');
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
      return { progress: 100, complete: true };
    case 'standby':
    case 'cancelled':
      return { progress: 0, complete: false };
    case 'printing':
    case 'paused':
    case 'error':
      return {
        progress: percentage(status.display_status?.progress ?? status.virtual_sdcard?.progress, 100),
        complete: false,
      };
    default:
      throw new Error('Could not read Moonraker print status');
  }
}

export function crealityProgress(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => finish(new Error('WebSocket timed out')), 5000);
    let settled = false;
    let deviceState;
    let jobState;
    let progress;
    let jobStateTimer;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(jobStateTimer);
      socket.close();
      if (error) reject(error);
      else resolve(value);
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ method: 'get', params: { deviceState: 1, printProgress: 1, state: 1 } }));
    });
    socket.addEventListener('error', () => finish(new Error('WebSocket connection failed')));
    socket.addEventListener('close', () => finish(new Error('WebSocket connection closed')));
    socket.addEventListener('message', ({ data }) => {
      if (data === 'heart_beat') {
        if (socket.readyState === WebSocket.OPEN) socket.send('ok');
        return;
      }
      try {
        const update = JSON.parse(data);
        if (update?.deviceState != null) deviceState = String(update.deviceState);
        if (update?.state != null) jobState = String(update.state);
        if (update?.printProgress != null) progress = update.printProgress;
      } catch {
        return;
      }
      if (deviceState === undefined || progress === undefined) return;
      if (jobState !== undefined) finishReading();
      else jobStateTimer ??= setTimeout(finishReading, 250);
    });

    function finishReading() {
      try {
        const value = percentage(progress);
        finish(null, {
          progress: deviceState === '0' && value < 100 ? 0 : value,
          complete: jobState === undefined ? undefined : jobState === '2',
        });
      } catch (error) {
        finish(error);
      }
    }
  });
}
