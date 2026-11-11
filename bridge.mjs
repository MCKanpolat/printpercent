import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { loadConfig } from './src/config.mjs';
import { cubeClient, printerEndpoints } from './src/cube.mjs';

async function main() {
  const { ihost, service, token, printers } = loadConfig(process.env);
  const cube = cubeClient(ihost, token, service.href);
  const endpointStates = new Map();

  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== service.pathname) {
      response.writeHead(404).end();
      return;
    }
    let directive;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(chunk);
      }
      ({ directive } = JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } catch {
      response.writeHead(400).end();
      return;
    }
    const header = directive?.header;
    const isQuery = header?.name === 'QueryDeviceStates';
    if ((!isQuery && header?.name !== 'UpdateDeviceStates') || typeof header.message_id !== 'string') {
      response.writeHead(403).end();
      return;
    }
    const state = endpointStates.get(directive.endpoint?.third_serial_number) ??
      endpointStates.get(directive.endpoint?.serial_number);
    if (!isQuery) {
      // Progress lights are read-only: acknowledge the command, ignore it, and let the
      // next sync push the real printer state back so Apple Home stops showing a spinner.
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        event: {
          header: { name: state ? 'Response' : 'ErrorResponse', message_id: header.message_id, version: '2' },
          payload: state ? { state } : { type: 'ENDPOINT_UNREACHABLE' },
        },
      }));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      event: {
        header: {
          name: state ? 'Response' : 'ErrorResponse',
          message_id: header.message_id,
          version: '2',
        },
        payload: state ? { state } : { type: 'ENDPOINT_UNREACHABLE' },
      },
    }));
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
      const registered = new Map(devices.status === 'fulfilled'
        ? devices.value.map((device) => [device.third_serial_number, device])
        : []);
      endpointStates.clear();
      const syncs = [];
      for (const [index, printer] of printers.entries()) {
        const reading = readings[index];
        for (const accessory of printerEndpoints(printer, reading.status === 'fulfilled' ? reading.value : null)) {
          const device = registered.get(accessory.id);
          if (accessory.state) {
            endpointStates.set(accessory.id, accessory.state);
            if (device?.serial_number) endpointStates.set(device.serial_number, accessory.state);
          }
          if (devices.status === 'fulfilled') {
            syncs.push(cube.sync(printer, accessory, device).catch((error) => {
              console.error(`${accessory.name}: ${error.message}`);
            }));
          }
        }
      }
      if (devices.status === 'rejected') {
        console.error(`iHost: ${devices.reason.message}`);
      }
      await Promise.all(syncs);
      await delay(3000, undefined, { signal: shutdown.signal }).catch((error) => {
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
