import { crealityProgress, moonrakerReader } from './printers.mjs';

const http = ['http:', 'https:'];
const websocket = ['ws:', 'wss:'];

function parseUrl(value, field, protocols) {
  const url = typeof value === 'string' && URL.canParse(value) ? new URL(value) : null;
  if (!url || !protocols.includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error(`${field} must be a valid ${protocols.join(' or ')} URL`);
  }
  return url;
}

function legacyPrinters(env) {
  const printers = [];
  if (env.K1C_WS_URL) {
    printers.push({
      id: 'k1c', name: 'Creality K1C Print Progress', type: 'creality',
      manufacturer: 'Creality', model: 'K1C', url: env.K1C_WS_URL,
    });
  }
  if (env.U1_URL) {
    printers.push({
      id: 'u1', name: 'Snapmaker U1 Print Progress', type: 'moonraker',
      manufacturer: 'Snapmaker', model: 'U1', url: env.U1_URL, apiKeyEnv: env.U1_API_KEY ? 'U1_API_KEY' : undefined,
    });
  }
  return printers;
}

function configuredPrinters(env) {
  if (!env.PRINTERS_JSON?.trim()) return legacyPrinters(env);
  try {
    return JSON.parse(env.PRINTERS_JSON);
  } catch {
    throw new Error('PRINTERS_JSON must contain a valid JSON array');
  }
}

export function loadConfig(env) {
  const ihost = parseUrl(env.IHOST_URL, 'IHOST_URL', http);
  const service = parseUrl(env.SERVICE_URL, 'SERVICE_URL', http);
  const token = env.IHOST_TOKEN?.trim();
  if (!token) throw new Error('IHOST_TOKEN is required');

  const entries = configuredPrinters(env);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('Configure at least one printer in PRINTERS_JSON');
  }

  const ids = new Set();
  const printers = entries.map((entry, index) => {
    const field = `Printer ${index + 1}`;
    if (typeof entry?.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(entry.id) || ids.has(entry.id)) {
      throw new Error(`${field} must have a unique lowercase id (letters, numbers or hyphens)`);
    }
    ids.add(entry.id);
    const type = entry.type ?? 'moonraker';
    if (type !== 'moonraker' && type !== 'creality') {
      throw new Error(`${field} type must be moonraker or creality`);
    }
    if (typeof entry.name !== 'string' || !entry.name.trim()) {
      throw new Error(`${field} name is required`);
    }
    const url = parseUrl(entry.url, `${field} url`, type === 'moonraker' ? http : websocket);
    let apiKey;
    if (entry.apiKeyEnv !== undefined) {
      if (type !== 'moonraker' || typeof entry.apiKeyEnv !== 'string' ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.apiKeyEnv) || !env[entry.apiKeyEnv]?.trim()) {
        throw new Error(`${field} apiKeyEnv must name a configured Moonraker API key variable`);
      }
      apiKey = env[entry.apiKeyEnv].trim();
    }
    return {
      id: `printerstatus-${entry.id}`,
      name: entry.name.trim(),
      manufacturer: (typeof entry.manufacturer === 'string' && entry.manufacturer.trim()) || 'PrintPercent',
      model: (typeof entry.model === 'string' && entry.model.trim()) || 'Print Progress',
      read: type === 'moonraker' ? moonrakerReader(url, apiKey) : () => crealityProgress(url),
    };
  });
  return { ihost, service, token, printers };
}
