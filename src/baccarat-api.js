// ============================================
// BACCARAT PREDICTOR v4 - @sewdangcap
// Big Road + Derived Roads + Trend Fallback
// node baccarat_bot.js
// ============================================

const http  = require('http');
const fetch = require('node-fetch');

const API_URL  = 'https://treasures-night-much-knowing.trycloudflare.com/api/bcr';
const INTERVAL = 30000;
const PORT     = process.env.PORT || 3000;

// ============================================
// BIG ROAD
// ============================================
function buildBigRoad(raw) {
  const cols = [];
  let curSide = null, curCol = [];

  for (const ch of raw) {
    if (ch === 'T') {
      if (curCol.length > 0) curCol[curCol.length - 1] += 'T';
      else if (cols.length > 0) { const lc = cols[cols.length - 1]; lc[lc.length - 1] += 'T'; }
      continue;
    }
    if (ch !== curSide) {
      if (curCol.length > 0) cols.push(curCol);
      curCol = [ch]; curSide = ch;
    } else {
      if (curCol.length < 6) curCol.push(ch);
      else { cols.push(curCol); curCol = [ch]; curSide = ch; }
    }
  }
  if (curCol.length > 0) cols.push(curCol);
  return cols;
}

// ============================================
// DERIVED ROADS
// ============================================
function derivedRoad(cols, offset) {
  const result = [];
  for (let i = offset; i < cols.length; i++) {
    const colA = cols[i], colB = cols[i - offset];
    const maxRow = Math.max(colA.length, colB.length);
    for (let row = 0; row < maxRow; row++) {
      const a = colA[row] ? colA[row][0] : null;
      const b = colB[row] ? colB[row][0] : null;
      if (a === null && b === null) continue;
      if (a === null || b === null) result.push('B');
      else result.push(a === b ? 'R' : 'B');
    }
  }
  return result;
}

function predictFromDerived(cols, offset) {
  if (cols.length < offset + 2) return null;

  const lastCol   = cols[cols.length - 1];
  const lastEntry = lastCol[lastCol.length - 1];
  const lastSide  = lastEntry[0];

  const tryAppend = (side) => {
    const newCols = cols.map(c => [...c]);
    const lc = newCols[newCols.length - 1];
    if (side === lastSide && lc.length < 6) lc.push(side);
    else newCols.push([side]);
    const road = derivedRoad(newCols, offset);
    return road.length > 0 ? road[road.length - 1] : null;
  };

  const ifB = tryAppend('B');
  const ifP = tryAppend('P');

  if (ifB === 'R' && ifP === 'B') return 'B';
  if (ifP === 'R' && ifB === 'B') return 'P';

  const road = derivedRoad(cols, offset);
  if (road.length < 3) return null;
  const tail   = road.slice(-4);
  const rCount = tail.filter(x => x === 'R').length;
  const bCount = tail.filter(x => x === 'B').length;
  if (rCount >= 3) return lastSide;
  if (bCount >= 3) return lastSide === 'B' ? 'P' : 'B';
  return null;
}

// ============================================
// BIG ROAD PATTERN
// ============================================
function detectBigRoadPattern(cols) {
  if (cols.length < 2) return { name: 'Chưa rõ cầu', score: {} };
  const lengths     = cols.map(c => c.length).slice(-6);
  const curLen      = cols[cols.length - 1].length;
  const n           = lengths.length;
  const phaseOffset = cols.length % 2;

  if (lengths.every(x => x === 1)) return { name: 'Cầu đơn',      score: { tiepTuc: 0,   daoChieu: 3   } };
  if (lengths.every(x => x === 2)) return { name: 'Cầu đôi',      score: { tiepTuc: 0,   daoChieu: 3   } };
  if (curLen >= 6)                  return { name: `Bệt x${curLen}`, score: { tiepTuc: -2,  daoChieu: 4   } };
  if (curLen >= 4)                  return { name: `Bệt x${curLen}`, score: { tiepTuc: 1.5, daoChieu: 0   } };

  let is12 = n >= 4;
  for (let i = 0; i < n && is12; i++) {
    const p = (i + phaseOffset) % 2;
    if (p === 0 && lengths[i] !== 1) is12 = false;
    if (p === 1 && lengths[i] !== 2) is12 = false;
  }
  if (is12) return { name: 'Cầu 1-2', score: { tiepTuc: 2, daoChieu: 0 } };

  let is21 = n >= 4;
  for (let i = 0; i < n && is21; i++) {
    const p = (i + phaseOffset) % 2;
    if (p === 0 && lengths[i] !== 2) is21 = false;
    if (p === 1 && lengths[i] !== 1) is21 = false;
  }
  if (is21) return { name: 'Cầu 2-1', score: { tiepTuc: 2, daoChieu: 0 } };

  if (lengths.every(x => x === 3)) return { name: 'Cầu 3', score: { tiepTuc: 0, daoChieu: 2.5 } };

  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avg > 2.8) return { name: 'Nghiêng bệt', score: { tiepTuc: 1.5, daoChieu: 0 } };

  return { name: 'Hỗn hợp', score: { tiepTuc: 0, daoChieu: 0 } };
}

// ============================================
// SHOE POSITION BONUS
// ============================================
function shoeBonus(raw, ratio) {
  const len = raw.length;
  let bB = 0, bP = 0;
  if (len < 20) {
    if (ratio > 0.65) bB += 1;
    else if (ratio < 0.35) bP += 1;
  }
  if (len > 55) {
    if (ratio > 0.55) bB += 1.5;
    else if (ratio < 0.45) bP += 1.5;
  }
  return { bB, bP };
}

// ============================================
// TIE CYCLE
// ============================================
function checkTieCycle(raw) {
  const tPos = [];
  raw.split('').forEach((x, i) => { if (x === 'T') tPos.push(i); });
  if (tPos.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < tPos.length; i++) gaps.push(tPos[i] - tPos[i - 1]);
  const avgGap       = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const distFromLast = raw.length - 1 - tPos[tPos.length - 1];
  if (Math.abs(distFromLast - avgGap) <= 1.5 && avgGap >= 4 && avgGap <= 14) return 8;
  return 0;
}

// ============================================
// ANALYZE
// ============================================
function analyze(results, goodRoad) {
  const raw = results.toUpperCase().replace(/[^BPT]/g, '');
  if (raw.length < 6) return { dudoan: 'Chua du du lieu', ti_le: 0 };

  const cols = buildBigRoad(raw);
  if (cols.length < 2) return { dudoan: 'Chua du du lieu', ti_le: 0 };

  const lastCol = cols[cols.length - 1];
  const curSide = lastCol[lastCol.length - 1][0];
  const oppSide = curSide === 'B' ? 'P' : 'B';

  const nonTie = raw.replace(/T/g, '').split('');
  let streak = 1;
  for (let i = nonTie.length - 2; i >= 0; i--) {
    if (nonTie[i] === nonTie[nonTie.length - 1]) streak++;
    else break;
  }

  let voteB = 0, voteP = 0;

  const beb = predictFromDerived(cols, 1);
  const sr  = predictFromDerived(cols, 2);
  const cr  = predictFromDerived(cols, 3);

  if (beb === 'B') voteB += 3.0; else if (beb === 'P') voteP += 3.0;
  if (sr  === 'B') voteB += 2.5; else if (sr  === 'P') voteP += 2.5;
  if (cr  === 'B') voteB += 2.0; else if (cr  === 'P') voteP += 2.0;

  const pattern = detectBigRoadPattern(cols);
  if ((pattern.score.tiepTuc || 0) > 0) {
    if (curSide === 'B') voteB += pattern.score.tiepTuc;
    else voteP += pattern.score.tiepTuc;
  }
  if ((pattern.score.daoChieu || 0) > 0) {
    if (oppSide === 'B') voteB += pattern.score.daoChieu;
    else voteP += pattern.score.daoChieu;
  }

  const r20   = nonTie.slice(-20);
  const r20B  = r20.filter(x => x === 'B').length;
  const r20P  = r20.filter(x => x === 'P').length;
  const ratio = r20B / (r20B + r20P || 1);
  if (ratio > 0.62) voteB += 1.5;
  else if (ratio < 0.38) voteP += 1.5;

  const shoe = shoeBonus(raw, ratio);
  voteB += shoe.bB;
  voteP += shoe.bP;

  const tieVote = checkTieCycle(raw);

  if (goodRoad) {
    if (goodRoad.includes('Cai')) voteB += 1.5;
    if (goodRoad.includes('Con')) voteP += 1.5;
    if (goodRoad.includes('Cái')) voteB += 1.5;
    if (goodRoad.includes('Con')) voteP += 1.5;
  }

  const MAX_STREAK = 4;
  const tenViet    = { B: 'Cái', P: 'Con', T: 'Hòa' };
  let pred, conf;

  if (tieVote > 0 && tieVote > voteB && tieVote > voteP) {
    pred = 'T';
    conf = Math.min(Math.round((tieVote / (voteB + voteP + tieVote + 0.01)) * 100), 85);
  } else {
    if (streak >= MAX_STREAK && voteB >= voteP && curSide === 'B') {
      pred = 'P'; conf = 62;
    } else if (streak >= MAX_STREAK && voteP >= voteB && curSide === 'P') {
      pred = 'B'; conf = 62;
    } else {
      pred = voteB >= voteP ? 'B' : 'P';
      const total = voteB + voteP + 0.01;
      conf = Math.min(Math.round((Math.max(voteB, voteP) / total) * 100), 95);
      const agree = [beb, sr, cr].filter(x => x === pred).length;
      if (agree === 3) conf = Math.min(conf + 10, 95);
      else if (agree === 2) conf = Math.min(conf + 5, 95);
    }
  }

  return { dudoan: tenViet[pred], ti_le: conf };
}

// ============================================
// CACHE
// ============================================
let cache     = null;
let lastFetch = 0;

async function fetchAndCache() {
  try {
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 10000);
    const res        = await fetch(API_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    const json = await res.json();
    if (json.code !== 200 || !Array.isArray(json.data)) throw new Error('API loi');

    cache = json.data
      .filter(x => x.results && x.results.length >= 4)
      .map(item => {
        const a = analyze(item.results, item.good_road);
        return {
          ban:        item.ban,
          du_doan:    a.dudoan,
          do_tin_cay: `${a.ti_le}%`,
        };
      });

    lastFetch = Date.now();
    console.log(`[${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}] Cap nhat ${cache.length} ban`);
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

// Polling vong lap an toan
async function loop() {
  await fetchAndCache();
  setTimeout(loop, INTERVAL);
}

// ============================================
// HTTP SERVER
// ============================================
function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type':   'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // GET /api/bcr  →  toan bo ban
  if (req.method === 'GET' && url === '/api/bcr') {
    if (!cache) return sendJSON(res, 503, { loi: 'Chua co du lieu, thu lai sau' });
    return sendJSON(res, 200, {
      id:       '@sewdangcap',
      cap_nhat: new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      tong_ban: cache.length,
      du_lieu:  cache,
    });
  }

  // GET /api/bcr/:ban  →  mot ban cu the
  const match = url.match(/^\/api\/bcr\/(.+)$/);
  if (req.method === 'GET' && match) {
    if (!cache) return sendJSON(res, 503, { loi: 'Chua co du lieu, thu lai sau' });
    const banId = decodeURIComponent(match[1]).trim();
    const item  = cache.find(x => String(x.ban).trim() === banId);
    if (!item) return sendJSON(res, 404, { loi: `Khong tim thay ban: ${banId}` });
    return sendJSON(res, 200, {
      id:       '@sewdangcap',
      cap_nhat: new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      ...item,
    });
  }

  // 404
  sendJSON(res, 404, { loi: 'Route khong ton tai' });
});

server.listen(PORT, () => {
  console.log(`Server chay tai http://localhost:${PORT}`);
  console.log(`  GET /api/bcr        -> toan bo ban`);
  console.log(`  GET /api/bcr/:ban   -> mot ban cu the`);
  loop();
});
