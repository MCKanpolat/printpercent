import { randomUUID } from 'node:crypto';
import { json } from './http.mjs';

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
    async sync(printer, device, progress) {
      const online = progress !== null;
      if (!device) {
        if (!online) return;
        await event('DiscoveryRequest', {
          endpoints: [{
            third_serial_number: printer.id,
            name: `${printer.name}`,
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
