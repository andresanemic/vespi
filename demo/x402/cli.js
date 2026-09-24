function parseArgs(args, allowed) {
  const parsed = {};
  for (const arg of args) {
    if (typeof arg !== 'string' || !arg.startsWith('--')) throw new Error('unexpected positional argument');
    const separator = arg.indexOf('=');
    if (separator < 0) throw new Error(`missing value for ${arg}`);
    const name = arg.slice(0, separator);
    if (allowed && !allowed.has(name)) throw new Error(`unknown argument ${name}`);
    if (Object.prototype.hasOwnProperty.call(parsed, name)) throw new Error(`duplicate argument ${name}`);
    parsed[name] = arg.slice(separator + 1);
  }
  return parsed;
}

function validateServiceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('service URL is invalid');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('service URL must use HTTPS except for localhost');
  }
  return value;
}

export { parseArgs, validateServiceUrl };
