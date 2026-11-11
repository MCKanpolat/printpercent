import { randomUUID } from 'node:crypto';
import { json } from './http.mjs';

export function printerEndpoints(printer, reading) {
  const progress = reading?.progress;
  const endpoints = [{
    id: `pp-progress-${printer.id}`,
    name: printer.name,
    category: 'light',
    capabilities: ['power', 'brightness'],
    state: reading && {
      power: { powerState: progress > 0 ? 'on' : 'off' },
      brightness: { brightness: progress },
    },
  }, {
    id: `pp-complete-${printer.id}`,
    name: `${printer.name.replace(/ print progress$/i, '')} Print Complete`,
    category: 'contactSensor',
    capabilities: ['contact'],
    state: typeof reading?.complete === 'boolean' ? { contact: { contact: reading.complete } } : null,
  }];
  return endpoints;
}

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
      throw new Error(`CUBE ${name}: ${body.payload?.type ?? 'unexpected response'}`);
    }
  }

  return {
    async devices() {
      const body = await json(listUrl, { headers });
      if (body.error !== 0 || !Array.isArray(body.data?.device_list)) {
        throw new Error('Could not read the CUBE device list');
      }
      return body.data.device_list;
    },
    async sync(printer, accessory, device) {
      const online = accessory.state !== null;
      if (!device) {
        if (!online) return;
        await event('DiscoveryRequest', {
          endpoints: [{
            third_serial_number: accessory.id,
            name: accessory.name,
            display_category: accessory.category,
            capabilities: accessory.capabilities.map((capability) => ({
              capability, permission: accessory.category === 'light' ? '1100' : '0100',
            })),
            state: accessory.state,
            manufacturer: printer.manufacturer,
            model: printer.model,
            firmware_version: '1.1.0',
            service_address: serviceAddress,
          }],
        });
        return;
      }

      const endpoint = { serial_number: device.serial_number, third_serial_number: accessory.id };
      if (online && Object.entries(accessory.state).some(([capability, fields]) =>
        Object.entries(fields).some(([key, value]) => device.state?.[capability]?.[key] !== value))) {
        await event('DeviceStatesChangeReport', { state: accessory.state }, endpoint);
      }
      if (device.online !== online) {
        await event('DeviceOnlineChangeReport', { online }, endpoint);
      }
    },
  };
}
