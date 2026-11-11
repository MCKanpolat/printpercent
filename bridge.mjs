import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { loadConfig } from './src/config.mjs';
import { cubeClient, printerEndpoints } from './src/cube.mjs';

async function main() {
  const { ihost, service, token, printers } = loadConfig(process.env);
  const cube = cubeClient(ihost, token, service.href);

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
  console.log('PrintPercent is running');

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
        const status = reading.status === 'fulfilled' ? reading.value : null;
        const message = status ? `${status.progress}%${status.complete ? ' (complete)' : ''}` : reading.reason.message;
        if (lastRead.get(printer.id) !== message) {
          console.log(`${printer.name}: ${message}`);
          lastRead.set(printer.id, message);
        }
      }
      if (devices.status === 'fulfilled') {
        const registered = new Map(devices.value.map((device) => [device.third_serial_number, device]));
        for (const [index, printer] of printers.entries()) {
          const reading = readings[index];
          for (const accessory of printerEndpoints(printer, reading.status === 'fulfilled' ? reading.value : null)) {
            try {
              await cube.sync(printer, accessory, registered.get(accessory.id));
            } catch (error) {
              console.error(`${accessory.name}: ${error.message}`);
            }
          }
        }
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
