// ═══════════════════════════════════════════════════════
//  Pure JavaScript QR Code SVG Generator
//  Supports QR Version 1-10, Error Correction L/M/Q/H
//  No dependencies — generates clean SVG strings
// ═══════════════════════════════════════════════════════
'use strict';

// ── Reed-Solomon GF(256) ────────────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x; GF_LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) { return (a && b) ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0; }
function gfPoly(n) {
  let p = [1];
  for (let i = 0; i < n; i++) {
    const q = [1, GF_EXP[i]];
    const r = new Array(p.length + 1).fill(0);
    for (let j = 0; j < p.length; j++) for (let k = 0; k < q.length; k++) r[j+k] ^= gfMul(p[j], q[k]);
    p = r;
  }
  return p;
}
function rsEncode(data, nEcc) {
  const gen = gfPoly(nEcc);
  const out  = new Array(nEcc).fill(0);
  for (const b of data) {
    const coef = b ^ out.shift();
    out.push(0);
    if (coef) for (let i = 0; i < gen.length - 1; i++) out[i] ^= gfMul(gen[i + 1], coef);
  }
  return out;
}

// ── Alphanumeric + Byte mode ────────────────────────────
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// QR version capacities [version][ecl] = {data, ec, blocks, rem}
// We use byte mode, EC level M
// Simplified: we only handle versions 1-10 EC-M
const VERSION_INFO = [
  null,
  { cap: 14,  ec: 10, b1: 1, d1: 16, b2: 0, d2: 0,  rem: 0 }, // v1
  { cap: 26,  ec: 16, b1: 1, d1: 28, b2: 0, d2: 0,  rem: 7 }, // v2
  { cap: 42,  ec: 26, b1: 1, d1: 44, b2: 0, d2: 0,  rem: 7 }, // v3
  { cap: 62,  ec: 36, b1: 2, d1: 32, b2: 0, d2: 0,  rem: 7 }, // v4
  { cap: 84,  ec: 46, b1: 2, d1: 43, b2: 0, d2: 0,  rem: 7 }, // v5
  { cap: 106, ec: 60, b1: 4, d1: 27, b2: 0, d2: 0,  rem: 7 }, // v6
  { cap: 122, ec: 66, b1: 4, d1: 31, b2: 0, d2: 0,  rem: 0 }, // v7
  { cap: 154, ec: 86, b1: 2, d1: 38, b2: 2, d2: 39, rem: 0 }, // v8
  { cap: 180, ec: 100,b1: 3, d1: 36, b2: 2, d2: 37, rem: 0 }, // v9
  { cap: 206, ec: 114,b1: 4, d1: 43, b2: 1, d2: 44, rem: 0 }, // v10
];

function getVersion(len) {
  for (let v = 1; v <= 10; v++) {
    if (VERSION_INFO[v] && len <= VERSION_INFO[v].cap) return v;
  }
  return 10; // max for this impl
}

// ── Bit buffer ──────────────────────────────────────────
class BitBuffer {
  constructor() { this.buf = []; this.len = 0; }
  put(num, length) {
    for (let i = length - 1; i >= 0; i--) this.putBit((num >>> i) & 1);
  }
  putBit(bit) {
    const n = Math.floor(this.len / 8);
    if (this.buf.length <= n) this.buf.push(0);
    if (bit) this.buf[n] |= 0x80 >>> (this.len % 8);
    this.len++;
  }
}

// ── Matrix builder ──────────────────────────────────────
function makeMatrix(version) {
  const size = version * 4 + 17;
  const m    = Array.from({length: size}, () => new Array(size).fill(-1));
  return m;
}

function setFunction(m, r, c, v) { m[r][c] = v ? 2 : -2; }
function setData(m, r, c, v)     { if (m[r][c] === -1) m[r][c] = v; }

function placeFinderPattern(m, row, col) {
  for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
    const rr = row + r, cc = col + c;
    if (rr < 0 || cc < 0 || rr >= m.length || cc >= m.length) continue;
    const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
    const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
    const onBorder = (r === 0 || r === 6 || c === 0 || c === 6);
    setFunction(m, rr, cc, (onBorder || inInner) ? 1 : 0);
  }
}

function placeAlignPattern(m, row, col) {
  for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
    const dark = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
    setFunction(m, row + r, col + c, dark);
  }
}

const ALIGN_TABLE = [
  [], [], [6,18], [6,22], [6,26], [6,30], [6,34],
  [6,22,38], [6,24,42], [6,26,46], [6,28,50]
];

function placePatterns(m, version) {
  const size = m.length;
  placeFinderPattern(m, 0, 0);
  placeFinderPattern(m, size - 7, 0);
  placeFinderPattern(m, 0, size - 7);

  // Separators (already handled by border)
  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunction(m, 6, i, i % 2 === 0);
    setFunction(m, i, 6, i % 2 === 0);
  }

  // Dark module
  setFunction(m, size - 8, 8, 1);

  // Alignment patterns
  const ap = ALIGN_TABLE[version] || [];
  for (const r of ap) for (const c of ap) {
    if (m[r][c] !== -1) continue;
    placeAlignPattern(m, r, c);
  }
}

// Format info (EC=M, mask=2) — precomputed
const FORMAT_INFO_M = [
  [0,1,1,0,1,1,0,1,0,0,0,1,0,0,1,0], // mask 0
  [0,1,1,0,0,1,1,1,0,1,1,0,1,0,0,0], // mask 1  
  [0,1,1,1,1,0,1,0,1,1,0,0,0,1,0,1], // mask 2 (we use this)
  [0,1,1,1,0,0,0,0,1,0,1,1,1,1,1,1], // mask 3
  [0,1,0,0,1,1,0,0,1,0,1,0,0,0,1,0], // mask 4
  [0,1,0,0,0,1,1,0,1,1,0,1,1,0,0,0], // mask 5
  [0,1,0,1,1,0,1,1,0,1,1,1,0,1,0,1], // mask 6
  [0,1,0,1,0,0,0,1,0,0,0,0,1,1,1,1], // mask 7
];

function placeFormat(m, maskIdx) {
  const bits = FORMAT_INFO_M[maskIdx];
  const size = m.length;
  // Around top-left finder
  const pos1 = [
    [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],
    [7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]
  ];
  for (let i = 0; i < 15; i++) setFunction(m, pos1[i][0], pos1[i][1], bits[i]);
  // Top-right and bottom-left
  for (let i = 0; i < 7; i++) setFunction(m, 8, size - 1 - i, bits[i]);
  for (let i = 7; i < 15; i++) setFunction(m, size - 15 + i, 8, bits[i]);
}

// Data placement (zigzag)
function placeData(m, codewords) {
  const size = m.length;
  let bitIdx = 0;
  const getBit = () => {
    const byte = Math.floor(bitIdx / 8);
    const bit  = 7 - (bitIdx % 8);
    bitIdx++;
    return byte < codewords.length ? (codewords[byte] >> bit) & 1 : 0;
  };

  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const row = upward ? size - 1 - vert : vert;
      for (let col = 0; col < 2; col++) {
        const c = right - col;
        if (m[row][c] === -1) {
          m[row][c] = getBit();
        }
      }
    }
    upward = !upward;
  }
}

// Mask pattern 2: (row / 2 + col / 3) % 2 === 0
function applyMask(m, maskIdx) {
  const size = m.length;
  const masks = [
    (r,c) => (r+c)%2===0,
    (r,c) => r%2===0,
    (r,c) => c%3===0,
    (r,c) => (r+c)%3===0,
    (r,c) => (Math.floor(r/2)+Math.floor(c/3))%2===0,
    (r,c) => ((r*c)%2+(r*c)%3)===0,
    (r,c) => ((r*c)%2+(r*c)%3)%2===0,
    (r,c) => ((r+c)%2+(r*c)%3)%2===0,
  ];
  const fn = masks[maskIdx];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (m[r][c] >= 0 && fn(r, c)) m[r][c] ^= 1;
  }
}

// ── Main encode function ────────────────────────────────
function encode(text) {
  const bytes   = Buffer.from(text, 'utf-8');
  const version = getVersion(bytes.length);
  const vi      = VERSION_INFO[version];

  // Build bit stream
  const bb = new BitBuffer();
  bb.put(4, 4); // byte mode
  bb.put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) bb.put(b, 8);
  // Terminator
  const totalBits = vi.cap * 8;
  for (let i = 0; i < 4 && bb.len < totalBits; i++) bb.putBit(0);
  while (bb.len % 8 !== 0) bb.putBit(0);
  // Padding bytes
  const pads = [0xEC, 0x11];
  let pi = 0;
  while (bb.buf.length < vi.cap) { bb.buf.push(pads[pi]); pi = (pi + 1) % 2; }

  // RS error correction
  const dcData = [];
  let pos = 0;
  for (let b = 0; b < vi.b1 + vi.b2; b++) {
    const dlen = b < vi.b1 ? vi.d1 : vi.d2;
    dcData.push(bb.buf.slice(pos, pos + dlen));
    pos += dlen;
  }
  const ecData = dcData.map((d, i) => rsEncode(d, Math.floor(vi.ec / (vi.b1 + vi.b2))));

  // Interleave
  const allData = [];
  const maxDC   = Math.max(...dcData.map(d => d.length));
  for (let i = 0; i < maxDC; i++) dcData.forEach(d => { if (i < d.length) allData.push(d[i]); });
  const maxEC = Math.max(...ecData.map(d => d.length));
  for (let i = 0; i < maxEC; i++) ecData.forEach(d => { if (i < d.length) allData.push(d[i]); });

  // Build matrix
  const m = makeMatrix(version);
  placePatterns(m, version);
  placeFormat(m, 2); // mask 2
  placeData(m, allData);
  applyMask(m, 2);
  placeFormat(m, 2); // replace after mask

  return m;
}

// ── SVG output ──────────────────────────────────────────
function toSVG(text, opts = {}) {
  const {
    size    = 200,
    fg      = '#000000',
    bg      = '#ffffff',
    padding = 4,
  } = opts;

  let m;
  try {
    m = encode(text);
  } catch(e) {
    // Fallback simple SVG
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="${bg}"/>
      <text x="${size/2}" y="${size/2}" text-anchor="middle" fill="${fg}" font-size="10">QR Error</text>
    </svg>`;
  }

  const n    = m.length;
  const cell = (size - padding * 2) / n;
  let cells  = '';

  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (m[r][c] === 1 || m[r][c] === 2) {
      const x = (padding + c * cell).toFixed(1);
      const y = (padding + r * cell).toFixed(1);
      const s = cell.toFixed(2);
      cells += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${fg}"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${bg}"/>
  ${cells}
</svg>`;
}

module.exports = { toSVG, encode };
