type Audio = { duration?: number; silent?: boolean };

function wave(bytes: Buffer): Audio | null {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' ||
      bytes.readUInt32LE(4) + 8 !== bytes.length) return null;
  let byteRate = 0;
  let blockSize = 0;
  let samples: Buffer | undefined;
  for (let pos = 12; pos + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(pos + 4);
    const end = pos + 8 + size;
    if (end > bytes.length) return null;
    const id = bytes.toString('ascii', pos, pos + 4);
    if (id === 'fmt ') {
      if (byteRate || samples || size < 16) return null;
      let codec = bytes.readUInt16LE(pos + 8);
      const channels = bytes.readUInt16LE(pos + 10);
      const sampleRate = bytes.readUInt32LE(pos + 12);
      byteRate = bytes.readUInt32LE(pos + 16);
      blockSize = bytes.readUInt16LE(pos + 20);
      const bits = bytes.readUInt16LE(pos + 22);
      if (codec === 0xfffe && size >= 40 &&
          bytes.toString('hex', pos + 34, pos + 48) === '000000001000800000aa00389b71') {
        codec = bytes.readUInt16LE(pos + 32);
      }
      if (!channels || !sampleRate || blockSize !== channels * bits / 8 || byteRate !== sampleRate * blockSize ||
          !(codec === 1 && [8, 16, 24, 32].includes(bits) || codec === 3 && [32, 64].includes(bits))) return null;
    }
    if (id === 'data') {
      if (samples) return null;
      samples = bytes.subarray(pos + 8, end);
    }
    pos = end + (size % 2);
  }
  if (!byteRate || !samples?.length || samples.length % blockSize) return null;
  return { duration: samples.length / byteRate, silent: samples.every(byte => byte === samples[0]) };
}

function ogg(bytes: Buffer): Audio | null {
  let preSkip = 0;
  let lastGranule = 0;
  let serial = 0;
  let ended = false;
  let continued = false;
  let packetPrefix: Buffer = Buffer.alloc(0);
  let packets = 0;
  let sampleCount = 0;
  let lastPacket = 0;
  for (let pos = 0, page = 0; pos < bytes.length; page++) {
    if (ended || pos + 27 > bytes.length || bytes.toString('ascii', pos, pos + 4) !== 'OggS' || bytes[pos + 4] !== 0) return null;
    const flags = bytes[pos + 5];
    if (Boolean(flags & 1) !== continued) return null;
    const segments = bytes[pos + 26];
    const start = pos + 27 + segments;
    let end = start;
    if (!segments || start > bytes.length) return null;
    for (let segment = pos + 27; segment < start; segment++) end += bytes[segment];
    if (end > bytes.length || bytes.readUInt32LE(pos + 18) !== page) return null;
    if (page === 0) {
      if (!(flags & 2) || end - start < 19 || bytes.toString('ascii', start, start + 8) !== 'OpusHead' ||
          bytes[start + 8] !== 1 || !bytes[start + 9]) return null;
      serial = bytes.readUInt32LE(pos + 14);
      preSkip = bytes.readUInt16LE(start + 10);
    } else if (flags & 2 || bytes.readUInt32LE(pos + 14) !== serial) return null;
    let cursor = start;
    for (let segment = pos + 27; segment < start; segment++) {
      const size = bytes[segment];
      if (!continued) packetPrefix = bytes.subarray(cursor, cursor + Math.min(size, 8));
      cursor += size;
      continued = size === 255;
      if (continued) continue;
      if (packets === 1 && packetPrefix.toString('ascii') !== 'OpusTags') return null;
      if (packets >= 2) {
        lastPacket = Math.round(opusSeconds(packetPrefix) * 48_000);
        sampleCount += lastPacket;
      }
      packets++;
    }
    const granule = bytes.readBigInt64LE(pos + 6);
    if (granule >= BigInt(0)) {
      if (granule < lastGranule || granule > Number.MAX_SAFE_INTEGER) return null;
      lastGranule = Number(granule);
    }
    ended = Boolean(flags & 4);
    pos = end;
  }
  if (continued || lastGranule <= preSkip || lastGranule > sampleCount || sampleCount - lastGranule > lastPacket) return null;
  return { duration: (lastGranule - preSkip) / 48_000 };
}

function vint(bytes: Buffer, pos: number, strip: boolean) {
  const initial = bytes.readUInt8(pos);
  const length = Math.clz32(initial) - 23;
  if (length < 1 || length > (strip ? 8 : 4)) throw new RangeError('invalid EBML integer');
  let value = strip ? initial & (0xff >> length) : initial;
  let unknown = strip && value === (0xff >> length);
  for (let i = 1; i < length; i++) {
    const next = bytes.readUInt8(pos + i);
    value = value * 256 + next;
    unknown &&= next === 255;
  }
  return { value, length, unknown };
}

const segmentId = 0x18538067;
const headerId = 0x1a45dfa3;
const clusterId = 0x1f43b675;
const clusterBoundaries = new Set([
  headerId, segmentId, clusterId, 0x114d9b74, 0x1549a966, 0x1654ae6b,
  0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367,
]);

function* elements(bytes: Buffer, level: 'root' | 'segment' | 'cluster' | 'fields' = 'fields') {
  for (let pos = 0; pos < bytes.length;) {
    const id = vint(bytes, pos, false);
    const size = vint(bytes, pos + id.length, true);
    const start = pos + id.length + size.length;
    let end = size.unknown ? bytes.length : start + size.value;
    if (level === 'segment' && (id.value === segmentId || id.value === headerId) ||
        level === 'cluster' && clusterBoundaries.has(id.value) || end > bytes.length ||
        size.unknown && !(level === 'root' && id.value === segmentId || level === 'segment' && id.value === clusterId)) {
      throw new RangeError('invalid EBML element');
    }
    if (size.unknown && id.value === clusterId) {
      // An unknown-sized Cluster ends at the next Segment child or root element.
      end = start;
      while (end < bytes.length) {
        const childId = vint(bytes, end, false);
        if (clusterBoundaries.has(childId.value)) break;
        const childSize = vint(bytes, end + childId.length, true);
        end += childId.length + childSize.length + childSize.value;
        if (childSize.unknown || end > bytes.length) throw new RangeError('invalid EBML cluster');
      }
    }
    yield { id: id.value, data: bytes.subarray(start, end) };
    pos = end;
  }
}

function uint(bytes: Buffer) {
  if (bytes.length < 1 || bytes.length > 6) throw new RangeError('invalid EBML value');
  return bytes.readUIntBE(0, bytes.length);
}

// A repeated table or block would let one copy be measured and another decoded.
function single(found: { data: Buffer }[]) {
  if (found.length > 1) throw new RangeError('repeated media element');
  return found[0]?.data;
}

function opusSeconds(packet: Buffer) {
  const toc = packet.readUInt8(0);
  const config = toc >> 3;
  const ms = config >= 16 ? [2.5, 5, 10, 20][config % 4]
    : config >= 12 ? [10, 20][config % 2] : [10, 20, 40, 60][config % 4];
  const frames = (toc & 3) === 0 ? 1 : (toc & 3) === 3 ? packet.readUInt8(1) & 63 : 2;
  if (!frames || ms * frames > 120) throw new RangeError('invalid Opus packet');
  return ms * frames / 1000;
}

function webm(bytes: Buffer): Audio | null {
  const top = elements(bytes, 'root');
  const header = top.next().value;
  if (!header || header.id !== headerId ||
      !Array.from(elements(header.data)).some(el => el.id === 0x4282 && el.data.toString() === 'webm')) return null;
  const segment = top.next().value;
  if (segment?.id !== segmentId || Array.from(top).some(el => el.id !== 0xec && el.id !== 0xbf)) return null;
  let scale = 1_000_000;
  let track = 0;
  let first = Infinity;
  let last = -Infinity;
  let encoded = 0;
  let codecDelay = 0;
  for (const el of elements(segment.data, 'segment')) {
    if (el.id === 0x1549a966) {
      for (const info of elements(el.data)) if (info.id === 0x2ad7b1) scale = uint(info.data);
    }
    if (el.id === 0x1654ae6b) {
      for (const entry of elements(el.data)) {
        if (entry.id !== 0xae) continue;
        const fields = new Map(Array.from(elements(entry.data), field => [field.id, field.data]));
        if (track || fields.get(0x86)?.toString() !== 'A_OPUS' || fields.get(0x83)?.[0] !== 2) return null;
        track = uint(fields.get(0xd7) ?? Buffer.alloc(0));
        const delay = fields.get(0x56aa);
        if (delay) codecDelay = uint(delay) / 1e9;
        if (codecDelay > 65_535 / 48_000) return null;
      }
    }
    if (el.id !== clusterId) continue;
    if (!track || !scale) return null;
    let timestamp = 0;
    for (const child of elements(el.data, 'cluster')) {
      if (child.id === 0xe7) timestamp = uint(child.data);
      const block = child.id === 0xa3 ? child.data : child.id === 0xa0
        ? single(Array.from(elements(child.data)).filter(field => field.id === 0xa1)) : undefined;
      if (!block) continue;
      const id = vint(block, 0, true);
      if (id.value !== track || block.readUInt8(id.length + 2) & 6) return null;
      const start = (timestamp + block.readInt16BE(id.length)) * scale / 1e9;
      first = Math.min(first, start);
      const duration = opusSeconds(block.subarray(id.length + 3));
      encoded += duration;
      last = Math.max(last, start + duration);
    }
  }
  return Number.isFinite(first) ? { duration: Math.round((Math.max(last - first, encoded) - codecDelay) * 1000) / 1000 } : null;
}

function* boxes(bytes: Buffer, offset = 0) {
  for (let pos = offset; pos < bytes.length;) {
    const size = bytes.readUInt32BE(pos);
    const type = bytes.toString('ascii', pos + 4, pos + 8);
    const header = size === 1 ? 16 : 8;
    const length = size === 1 ? Number(bytes.readBigUInt64BE(pos + 8)) : size || bytes.length - pos;
    if (length < header || pos + length > bytes.length) throw new RangeError('invalid MP4 box');
    yield { type, data: bytes.subarray(pos + header, pos + length) };
    pos += length;
  }
}

function mp4(bytes: Buffer): Audio | null {
  const top = Array.from(boxes(bytes));
  const child = (data: Buffer | undefined, type: string) => data && single(Array.from(boxes(data)).filter(box => box.type === type));
  if (top[0]?.type !== 'ftyp' || !top.some(box => box.type === 'mdat' && box.data.length)) return null;
  const movie = top.find(box => box.type === 'moov')?.data;
  if (!movie) return null;
  const tracks = Array.from(boxes(movie)).filter(box => box.type === 'trak');
  if (tracks.length !== 1) return null;
  const media = child(tracks[0].data, 'mdia');
  const header = child(media, 'mdhd');
  const handler = child(media, 'hdlr');
  const table = child(child(media, 'minf'), 'stbl');
  const samples = child(table, 'stsd');
  if (!header || handler?.toString('ascii', 8, 12) !== 'soun' || !samples || samples.readUInt32BE(4) !== 1) return null;
  const entry = Array.from(boxes(samples, 8))[0];
  if (entry?.type !== 'mp4a') return null;
  const version = entry.data.readUInt16BE(8);
  if (version > 1) return null;
  const descriptors = Array.from(boxes(entry.data, version === 1 ? 44 : 28)).find(box => box.type === 'esds')?.data;
  if (!descriptors || !aacDescriptor(descriptors)) return null;
  const long = header[0] === 1;
  const scale = header.readUInt32BE(long ? 20 : 12);
  if (!scale || header[0] > 1) return null;
  const timing = child(table, 'stts');
  let duration = 0;
  if (timing) {
    const count = timing.readUInt32BE(4);
    if (timing.readUInt32BE(0) !== 0 || timing.length !== 8 + count * 8) return null;
    for (let pos = 8; pos < timing.length; pos += 8) {
      const samples = timing.readUInt32BE(pos);
      const delta = timing.readUInt32BE(pos + 4);
      if (!samples || !delta) return null;
      duration += samples * delta;
    }
    if (!Number.isSafeInteger(duration)) return null;
  }
  if (!top.some(box => box.type === 'moof')) return duration ? { duration: duration / scale } : null;
  // shortcut: fragmented MP4 uses transcription duration when sample timing is unavailable locally.
  const fragments = fragmentedDuration(top, movie, scale);
  return { duration: fragments === undefined ? undefined : duration / scale + fragments };
}

function aacDescriptor(data: Buffer) {
  let pos = 4;
  function descriptor(tag: number) {
    if (data.readUInt8(pos++) !== tag) return false;
    let size = 0;
    for (let i = 0; i < 4; i++) {
      const byte = data.readUInt8(pos++);
      size = size * 128 + (byte & 127);
      if (!(byte & 128)) return size > 0 && pos + size <= data.length;
    }
    return false;
  }
  if (!descriptor(3)) return false;
  const flags = data.readUInt8(pos + 2);
  pos += 3;
  if (flags & 0x80) pos += 2;
  if (flags & 0x40) pos += 1 + data.readUInt8(pos);
  if (flags & 0x20) pos += 2;
  return descriptor(4) && [0x40, 0x66, 0x67, 0x68].includes(data.readUInt8(pos));
}

function fragmentedDuration(top: { type: string; data: Buffer }[], movie: Buffer, scale: number) {
  const mvex = Array.from(boxes(movie)).find(box => box.type === 'mvex')?.data;
  const trex = mvex && Array.from(boxes(mvex)).find(box => box.type === 'trex')?.data;
  let total = 0;
  for (const fragment of top.filter(box => box.type === 'moof')) {
    for (const { data } of Array.from(boxes(fragment.data)).filter(box => box.type === 'traf')) {
      const children = Array.from(boxes(data));
      const tfhd = children.find(box => box.type === 'tfhd')?.data;
      if (!tfhd) return;
      const flags = tfhd.readUIntBE(1, 3);
      const defaultPos = 8 + (flags & 1 ? 8 : 0) + (flags & 2 ? 4 : 0);
      const fallback = flags & 8 ? tfhd.readUInt32BE(defaultPos) : trex?.readUInt32BE(12);
      for (const { data: run } of children.filter(box => box.type === 'trun')) {
        const bits = run.readUIntBE(1, 3);
        const count = run.readUInt32BE(4);
        if (!(bits & 0x100)) {
          if (!fallback) return;
          total += fallback * count;
          continue;
        }
        const start = 8 + (bits & 1 ? 4 : 0) + (bits & 4 ? 4 : 0);
        const stride = 4 * (1 + Number(Boolean(bits & 0x200)) + Number(Boolean(bits & 0x400)) + Number(Boolean(bits & 0x800)));
        if (start + count * stride > run.length) throw new RangeError('invalid MP4 sample table');
        for (let i = 0; i < count; i++) total += run.readUInt32BE(start + i * stride);
      }
    }
  }
  return total > 0 ? total / scale : undefined;
}

export function readVoiceAudio(bytes: Buffer, contentType: string): Audio | null {
  try {
    switch (contentType) {
      case 'audio/wav': case 'audio/wave': case 'audio/x-wav': return wave(bytes);
      case 'audio/ogg': return ogg(bytes);
      case 'audio/webm': return webm(bytes);
      case 'audio/mp4': return mp4(bytes);
      default: return null;
    }
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

export function voiceMediaType(header: string) {
  const [type, ...parameters] = header.toLowerCase().split(';').map(part => part.trim());
  const codec = parameters.find(part => part.startsWith('codecs='))?.slice(7).replace(/^"|"$/g, '');
  if (type === 'audio/webm' || type === 'audio/ogg') return !codec || codec === 'opus' ? type : null;
  if (type === 'audio/mp4') return !codec || /^mp4a\.40\.\d+$/.test(codec) || codec === 'aac' ? type : null;
  return ['audio/wav', 'audio/wave', 'audio/x-wav'].includes(type) && !codec ? 'audio/wav' : null;
}
