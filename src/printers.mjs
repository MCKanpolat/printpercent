import { json } from './http.mjs';

function percentage(value, scale = 1) {
  if (typeof value === 'string' && value.trim()) value = Number(value);
  if (!Number.isFinite(value) || value < 0 || value > 100 / scale) {
    throw new Error('Invalid print progress');
  }
  return Math.round(value * scale);
}

export function moonrakerReader(base, key) {
  const headers = key ? { 'X-Api-Key': key } : {};
  const queryUrl = new URL(base);
  const prefix = queryUrl.pathname.replace(/\/$/, '');
  queryUrl.pathname = `${prefix}/printer/objects/query`;
  queryUrl.search = 'print_stats=state,filename&display_status=progress&virtual_sdcard=progress,file_position';
  let cachedFile;

  return async function read() {
    const body = await json(queryUrl, { headers });
    const status = body.result?.status;
    const { state, filename } = status?.print_stats ?? {};
    if (state === 'complete' || state === 'standby' || state === 'cancelled') {
      cachedFile = undefined;
      return { progress: state === 'complete' ? 100 : 0, complete: state === 'complete' };
    }
    if (state !== 'printing' && state !== 'paused' && state !== 'error') {
      throw new Error('Could not read Moonraker print status');
    }

    const sd = status.virtual_sdcard;
    if (filename && Number.isFinite(sd?.file_position) &&
        (cachedFile?.name !== filename || Date.now() >= cachedFile.retryAt)) {
      const metadataUrl = new URL(queryUrl);
      metadataUrl.pathname = `${prefix}/server/files/metadata`;
      metadataUrl.search = new URLSearchParams({ filename }).toString();
      const metadata = await json(metadataUrl, { headers }).catch(() => null);
      cachedFile = {
        name: filename,
        start: metadata?.result?.gcode_start_byte,
        end: metadata?.result?.gcode_end_byte,
        retryAt: metadata ? Infinity : Date.now() + 30000,
      };
    }

    let progress = sd?.progress ?? status.display_status?.progress;
    const file = cachedFile?.name === filename ? cachedFile : undefined;
    const { start, end } = file ?? {};
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && Number.isFinite(sd?.file_position)) {
      progress = Math.max(0, Math.min(1, (sd.file_position - start) / (end - start)));
    }
    if (typeof progress === 'string' && progress.trim()) progress = Number(progress);
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
      throw new Error('Invalid print progress');
    }
    return { progress: Math.floor(progress * 100), complete: false };
  };
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
