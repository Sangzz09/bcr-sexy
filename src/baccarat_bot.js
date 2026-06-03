// ============================================
// BACCARAT PREDICTOR v4 - @sewdangcap
// Dual source: API cũ (results chuỗi) + API mới (stats)
// node baccarat_bot.js
// ============================================

const http  = require('http');
const fetch = require('node-fetch');

const API_OLD  = 'https://treasures-night-much-knowing.trycloudflare.com/api/bcr';
const API_NEW  = 'https://nick-ingredients-leave-census.trycloudflare.com/api/bcr';
const INTERVAL = 30000;
const PORT     = process.env.PORT || 3000;

const BAN_IDS = [
  '1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15',
  'C01','C02','C03','C04','C05','C06','C07',
  'C08','C09','C10','C11','C12','C13','C14','C15',
];

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
  const lastSide  = lastCol[lastCol.length - 1][0];

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
  if (cols.length < 2) return { name: 'Chua ro cau', score: {} };
  const lengths     = cols.map(c => c.length).slice(-6);
  const curLen      = cols[cols.length - 1].length;
  const n           = lengths.length;
  const phaseOffset = cols.length % 2;

  if (lengths.every(x => x === 1)) return { name: 'Cau don',     score: { tiepTuc: 0,   daoChieu: 3   } };
  if (lengths.every(x => x === 2)) return { name: 'Cau doi',     score: { tiepTuc: 0,   daoChieu: 3   } };
  if (curLen >= 6) return { name: `Bet x${curLen}`, score: { tiepTuc: -2, daoChieu: 4 } };
  if (curLen >= 4) return { name: `Bet x${curLen}`, score: { tiepTuc: 1.5, daoChieu: 0 } };

  let is12 = n >= 4;
  for (let i = 0; i < n && is12; i++) {
    const p = (i + phaseOffset) % 2;
    if (p === 0 && lengths[i] !== 1) is12 = false;
    if (p === 1 && lengths[i] !== 2) is12 = false;
  }
  if (is12) return { name: 'Cau 1-2', score: { tiepTuc: 2, daoChieu: 0 } };

  let is21 = n >= 4;
  for (let i = 0; i < n && is21; i++) {
    const p = (i + phaseOffset) % 2;
    if (p === 0 && lengths[i] !== 2) is21 = false;
    if (p === 1 && lengths[i] !== 1) is21 = false;
  }
  if (is21) return { name: 'Cau 2-1', score: { tiepTuc: 2, daoChieu: 0 } };

  if (lengths.every(x => x === 3)) return { name: 'Cau 3', score: { tiepTuc: 0, daoChieu: 2.5 } };
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avg > 2.8) return { name: 'Nghieng bet', score: { tiepTuc: 1.5, daoChieu: 0 } };
  return { name: 'Hon hop', score: { tiepTuc: 0, daoChieu: 0 } };
}

// ============================================
// SHOE BONUS
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
// NORMALIZE
// ============================================
function normalize(rawScore) {
  const MIN_OUT = 60, MAX_OUT = 90;
  const clamped = Math.max(40, Math.min(100, rawScore));
  const mapped = MIN_OUT + ((clamped - 40) / (100 - 40)) * (MAX_OUT - MIN_OUT);
  return Math.round(mapped);
}

// ============================================
// ANALYZE
// ============================================
function analyze(oldData, newData) {
  let voteB = 0, voteP = 0;
  let beb = null, sr = null, cr = null;

  const raw = oldData
    ? (oldData.results || '').toUpperCase().replace(/[^BPT]/g, '')
    : '';

  let curSide = null, oppSide = null, streak = 0;
  let cols = [];

  if (raw.length >= 6) {
    cols = buildBigRoad(raw);

    if (cols.length >= 2) {
      const lastCol = cols[cols.length - 1];
      curSide = lastCol[lastCol.length - 1][0];
      oppSide = curSide === 'B' ? 'P' : 'B';

      const nonTie = raw.replace(/T/g, '').split('');
      streak = 1;
      for (let i = nonTie.length - 2; i >= 0; i--) {
        if (nonTie[i] === nonTie[nonTie.length - 1]) streak++;
        else break;
      }

      beb = predictFromDerived(cols, 1);
      sr  = predictFromDerived(cols, 2);
      cr  = predictFromDerived(cols, 3);
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

      const nonTieArr = nonTie;
      const r20  = nonTieArr.slice(-20);
      const r20B = r20.filter(x => x === 'B').length;
      const r20P = r20.filter(x => x === 'P').length;
      const ratio = r20B / (r20B + r20P || 1);
      if (ratio > 0.62) voteB += 1.5;
      else if (ratio < 0.38) voteP += 1.5;

      const shoe = shoeBonus(raw, ratio);
      voteB += shoe.bB;
      voteP += shoe.bP;

      const tieVote = checkTieCycle(raw);
      if (tieVote > 0 && tieVote > voteB && tieVote > voteP) {
        const rawConf = (tieVote / (voteB + voteP + tieVote + 0.01)) * 100;
        return { dudoan: 'Hòa', ti_le: normalize(rawConf) };
      }

      const gr = (oldData.good_road || '').toString();
      if (gr.includes('Cái') || gr.includes('Banker')) voteB += 1.5;
      if (gr.includes('Con')  || gr.includes('Player')) voteP += 1.5;
    }
  }

  if (newData) {
    const last5   = newData.last_5   || [];
    const stats   = newData.stats_55 || {};
    const recBet  = (newData.recommended_bet || '').toUpperCase();
    const betInfo = newData.bet_info || [];

    const l5results = last5.map(x => {
      const w = (x.winner || '').toLowerCase();
      if (w === 'banker') return 'B';
      if (w === 'player') return 'P';
      return 'T';
    });
    const l5B = l5results.filter(x => x === 'B').length;
    const l5P = l5results.filter(x => x === 'P').length;
    if (l5B > l5P) voteB += (l5B - l5P) * 0.6;
    else if (l5P > l5B) voteP += (l5P - l5B) * 0.6;

    if (!curSide && last5.length > 0) {
      const l5Side = l5results.filter(x => x !== 'T');
      curSide = l5Side[l5Side.length - 1] || null;
    }

    const total55 = (stats.banker || 0) + (stats.player || 0);
    if (total55 > 0) {
      const ratio55 = (stats.banker || 0) / total55;
      if (ratio55 > 0.62) voteB += 1.2;
      else if (ratio55 < 0.38) voteP += 1.2;
      else if (ratio55 > 0.55) voteB += 0.6;
      else if (ratio55 < 0.45) voteP += 0.6;
    }

    if (recBet.includes('BANKER')) voteB += 2.0;
    else if (recBet.includes('PLAYER')) voteP += 2.0;
    if (recBet.includes('THEO') && curSide === 'B') voteB += 1.2;
    else if (recBet.includes('THEO') && curSide === 'P') voteP += 1.2;

    const bankerBet = betInfo.find(x => x.type === 'Banker');
    const playerBet = betInfo.find(x => x.type === 'Player');
    if (bankerBet && playerBet) {
      const totalAmt = bankerBet.amount + playerBet.amount;
      if (totalAmt > 0) {
        const cr = bankerBet.amount / totalAmt;
        if (cr > 0.65) voteB += 1.0;
        else if (cr < 0.35) voteP += 1.0;
      }
    }
  }

  if (voteB === 0 && voteP === 0) return { dudoan: 'Chua du du lieu', ti_le: 0 };

  const MAX_STREAK = 4;
  const tenViet    = { B: 'Cái', P: 'Con' };
  let pred;
  let rawScore;

  if (streak >= MAX_STREAK && curSide === 'B' && voteB >= voteP) {
    pred = 'P'; rawScore = 50;
  } else if (streak >= MAX_STREAK && curSide === 'P' && voteP >= voteB) {
    pred = 'B'; rawScore = 50;
  } else {
    pred = voteB >= voteP ? 'B' : 'P';
    const total = voteB + voteP + 0.01;
    rawScore = (Math.max(voteB, voteP) / total) * 100;

    const agree = [beb, sr, cr].filter(x => x === pred).length;
    if (agree === 3) rawScore += 12;
    else if (agree === 2) rawScore += 6;
  }

  return { dudoan: tenViet[pred], ti_le: normalize(rawScore) };
}

// ============================================
// FETCH HELPERS
// ─ FIX 1: timeout 3s thay vì 8s
// ─ FIX 2: retry 1 lần nếu lần đầu fail/timeout
// ============================================
async function safeFetch(url, timeout = 3000, retry = 1) {
  for (let attempt = 0; attempt <= retry; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      return await res.json();
    } catch {
      clearTimeout(timer);
      // nếu còn lượt retry thì thử lại ngay
    }
  }
  return null;
}

// ============================================
// CACHE
// ============================================
let cache     = null;
let lastFetch = 0;

async function fetchAndCache() {
  try {
    // ─ FIX 3: fetch API cũ và toàn bộ API mới SONG SONG cùng lúc
    const [oldJson, ...newResults] = await Promise.all([
      safeFetch(API_OLD),
      ...BAN_IDS.map(id => safeFetch(`${API_NEW}/${id}`)),
    ]);

    const oldMap = {};
    if (oldJson && oldJson.code === 200 && Array.isArray(oldJson.data)) {
      for (const item of oldJson.data) {
        if (item.ban) oldMap[String(item.ban).trim()] = item;
      }
    }

    const newMap = {};
    for (let i = 0; i < BAN_IDS.length; i++) {
      const d = newResults[i];
      if (d && d.table) newMap[String(d.table).trim()] = d;
      else if (d) newMap[BAN_IDS[i]] = d;
    }

    const allBans = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    const banList = [];

    for (const ban of allBans) {
      const oldData = oldMap[ban] || null;
      const newData = newMap[ban] || null;

      if (!oldData && !newData) continue;
      if (newData && (!newData.last_5 || newData.last_5.length === 0) && !oldData) continue;

      const a = analyze(oldData, newData);
      if (a.ti_le === 0) continue;

      banList.push({
        ban:        ban,
        phien:      newData ? (newData.phien ?? null) : null,
        du_doan:    a.dudoan,
        do_tin_cay: `${a.ti_le}%`,
      });
    }

    banList.sort((a, b) => String(a.ban).localeCompare(String(b.ban), undefined, { numeric: true }));

    cache     = banList;
    lastFetch = Date.now();
    console.log(`[${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}] Cap nhat ${cache.length} ban (old:${Object.keys(oldMap).length} new:${Object.keys(newMap).length})`);
  } catch (err) {
    console.error('fetchAndCache error:', err.message);
  }
}

// ─ FIX 4: pipeline — bắt đầu fetch chu kỳ kế tiếp ngay sau khi fetch xong,
//   không chờ đủ INTERVAL kể từ lúc bắt đầu
async function loop() {
  const t0 = Date.now();
  await fetchAndCache();
  const elapsed = Date.now() - t0;
  const wait    = Math.max(0, INTERVAL - elapsed); // trừ đi thời gian đã fetch
  setTimeout(loop, wait);
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

  // GET /api/bcr
  if (req.method === 'GET' && url === '/api/bcr') {
    if (!cache) return sendJSON(res, 503, { loi: 'Chua co du lieu, thu lai sau' });
    return sendJSON(res, 200, {
      id:       '@sewdangcap',
      cap_nhat: new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      tong_ban: cache.length,
      du_lieu:  cache,
    });
  }

  // GET /api/bcr/:ban
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

  sendJSON(res, 404, { loi: 'Route khong ton tai' });
});

server.listen(PORT, () => {
  console.log(`Server chay tai http://localhost:${PORT}`);
  console.log(`  GET /api/bcr        -> toan bo ban`);
  console.log(`  GET /api/bcr/:ban   -> mot ban cu the`);
  loop();
});
