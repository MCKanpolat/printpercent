import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { loadConfig } from './src/config.mjs';
import { cubeClient } from './src/cube.mjs';

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
        const progress = reading.status === 'fulfilled' ? reading.value : null;
        if (lastRead.get(printer.id) !== progress) {
          console.log(`${printer.name}: ${progress === null ? reading.reason.message : `${progress}%`}`);
          lastRead.set(printer.id, progress);
        }
      }
      if (devices.status === 'fulfilled') {
        await Promise.all(printers.map(async (printer) => {
          const device = devices.value.find((item) => item.third_serial_number === printer.id);
          try {
            await cube.sync(printer, device, lastRead.get(printer.id));
          } catch (error) {
            console.error(`${printer.name}: ${error.message}`);
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
