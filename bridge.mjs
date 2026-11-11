import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

function percentage(value, scale = 1) {
  if (typeof value === 'string' && value.trim()) value = Number(value);
  if (!Number.isFinite(value) || value < 0 || value > 100 / scale) {
    throw new Error('Geçerli baskı yüzdesi alınamadı');
  }
  return Math.round(value * scale);
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export async function moonrakerProgress(base, key) {
  const url = new URL('printer/objects/query?print_stats=state&display_status=progress&virtual_sdcard=progress', base);
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

const humidity = (progress) => ({ humidity: { humidity: progress } });

export function cubeClient(base, token, serviceAddress) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const listUrl = new URL('open-api/v2/rest/devices', base);
  const eventUrl = new URL('open-api/v2/rest/thirdparty/event', base);

  async function event(name, payload, endpoint) {
    const body = await json(eventUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        event: { header: { name, message_id: randomUUID(), version: '2' }, endpoint, payload },
      }),
    });
    if (body.header?.name !== 'Response') {
      throw new Error(`CUBE ${name}: ${body.payload?.type ?? 'beklenmeyen yanıt'}`);
    }
  }

  return {
    async devices() {
      const body = await json(listUrl, { headers });
      if (body.error !== 0 || !Array.isArray(body.data?.device_list)) {
        throw new Error('CUBE cihaz listesi alınamadı');
      }
      return body.data.device_list;
    },
    async sync(printer, device, progress) {
      const online = progress !== null;
      if (!device) {
        if (!online) return;
        await event('DiscoveryRequest', {
          endpoints: [{
            third_serial_number: printer.id,
            name: `${printer.model} Baskı İlerlemesi`,
            display_category: 'humiditySensor',
            capabilities: [{ capability: 'humidity', permission: '0100' }],
            state: humidity(progress),
            manufacturer: printer.manufacturer,
            model: printer.model,
            firmware_version: '1.0.0',
            service_address: serviceAddress,
          }],
        });
        return;
      }

      const endpoint = { serial_number: device.serial_number, third_serial_number: printer.id };
      if (online && device.state?.humidity?.humidity !== progress) {
        await event('DeviceStatesChangeReport', { state: humidity(progress) }, endpoint);
      }
      if (device.online !== online) {
        await event('DeviceOnlineChangeReport', { online }, endpoint);
      }
    },
  };
}

function configuredUrl(name, protocols) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} ayarlanmalı`);
  const url = new URL(value);
  if (!protocols.includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} geçersiz`);
  }
  return url;
}

async function main() {
  const http = ['http:', 'https:'];
  const ihost = configuredUrl('IHOST_URL', http);
  const service = configuredUrl('SERVICE_URL', http);
  const k1c = configuredUrl('K1C_WS_URL', ['ws:', 'wss:']);
  const u1 = configuredUrl('U1_URL', http);
  const token = process.env.IHOST_TOKEN?.trim();
  if (!token) throw new Error('IHOST_TOKEN ayarlanmalı');
  const cube = cubeClient(ihost, token, service.href);
  const printers = [
    { id: 'printerstatus-k1c', model: 'K1C', manufacturer: 'Creality', read: () => crealityProgress(k1c) },
    { id: 'printerstatus-u1', model: 'U1', manufacturer: 'Snapmaker', read: () => moonrakerProgress(u1, process.env.U1_API_KEY) },
  ];

  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === service.pathname) {
      response.writeHead(403).end();
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8787, resolve);
  });
  console.log('Yazıcı köprüsü çalışıyor');

  const shutdown = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => shutdown.abort());
  }
  const lastRead = new Map();
  try {
    while (!shutdown.signal.aborted) {
      const [devices, ...readings] = await Promise.allSettled([
        cube.devices(), ...printers.map((printer) => printer.read()),
      ]);
      for (const [index, reading] of readings.entries()) {
        const printer = printers[index];
        const progress = reading.status === 'fulfilled' ? reading.value : null;
        if (lastRead.get(printer.id) !== progress) {
          console.log(`${printer.model}: ${progress === null ? reading.reason.message : `%${progress}`}`);
          lastRead.set(printer.id, progress);
        }
      }
      if (devices.status === 'fulfilled') {
        await Promise.all(printers.map(async (printer) => {
          const device = devices.value.find((item) => item.third_serial_number === printer.id);
          try {
            await cube.sync(printer, device, lastRead.get(printer.id));
          } catch (error) {
            console.error(`${printer.model}: ${error.message}`);
          }
        }));
      } else {
        console.error(`iHost: ${devices.reason.message}`);
      }
      await delay(10000, undefined, { signal: shutdown.signal }).catch((error) => {
        if (error.name !== 'AbortError') throw error;
      });
    }
  } finally {
    server.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
