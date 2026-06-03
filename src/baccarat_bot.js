// ============================================
// BACCARAT PREDICTOR v6 - @sewdangcap
// Smart polling: phat hien phien moi → du doan ngay
// Khong cho interval cung — fetch lien tuc, thong minh
// ============================================

const http  = require('http');
const fetch = require('node-fetch');

const API_OLD     = 'https://treasures-night-much-knowing.trycloudflare.com/api/bcr';
const API_NEW     = 'https://nick-ingredients-leave-census.trycloudflare.com/api/bcr';
const PORT        = process.env.PORT || 3000;

// --- Timing config ---
const POLL_IDLE     = 3000;   // Poll moi 3s khi khong co gi moi
const POLL_ACTIVE   = 800;    // Poll moi 800ms khi dang cho phien moi
const POLL_SLOWDOWN = 2000;   // Poll moi 2s neu lien tuc empty > 20 lan
const FETCH_TIMEOUT = 1800;   // Timeout moi request

const BAN_IDS = [
  '1','2','3','4','5','6','7','8','9','10',
  '11','12','13','14','15',
  'C01','C02','C03','C04','C05','C06','C07',
  'C08','C09','C10','C11','C12','C13','C14','C15',
];

// ============================================
// STATE - theo doi phien cuoi cua tung ban
// ============================================
const lastPhien   = new Map(); // ban -> phien cuoi da xu ly
const lastResults = new Map(); // ban -> results string cuoi

// ============================================
// BIG ROAD — chuan, khong gioi han chieu cao
// ============================================
function buildBigRoad(raw) {
  const cols  = [];
  let curSide = null;
  let curCol  = [];

  for (const ch of raw) {
    if (ch === 'T') {
      if (curCol.length > 0) curCol[curCol.length - 1] += 'T';
      else if (cols.length > 0) { const lc = cols[cols.length - 1]; lc[lc.length - 1] += 'T'; }
      continue;
    }
    if (ch !== curSide) {
      if (curCol.length > 0) cols.push(curCol);
      curCol  = [ch];
      curSide = ch;
    } else {
      curCol.push(ch);
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
    const colCur = cols[i];
    const colRef = cols[i - offset];
    const maxRow = Math.max(colCur.length, colRef.length);
    for (let row = 0; row < maxRow; row++) {
      const a = colCur[row] ? colCur[row][0] : null;
      const b = colRef[row] ? colRef[row][0] : null;
      if (a === null && b === null) continue;
      if (a === null || b === null) { result.push('B'); continue; }
      result.push(a === b ? 'R' : 'B');
    }
  }
  return result;
}

function predictFromDerived(cols, offset) {
  if (cols.length < offset + 1) return null;
  const lastCol  = cols[cols.length - 1];
  const lastSide = lastCol[lastCol.length - 1][0];

  const tryAppend = (side) => {
    const newCols = cols.map(c => [...c]);
    const lc = newCols[newCols.length - 1];
    if (side === lastSide) lc.push(side);
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
  const tail   = road.slice(-5);
  const rCount = tail.filter(x => x === 'R').length;
  const bCount = tail.filter(x => x === 'B').length;
  if (rCount >= 4) return lastSide;
  if (bCount >= 4) return lastSide === 'B' ? 'P' : 'B';
  return null;
}

// ============================================
// BIG ROAD PATTERN
// ============================================
function detectBigRoadPattern(cols) {
  if (cols.length < 3) return { name: 'Chua ro cau', betSide: null, weight: 0 };

  const recent  = cols.slice(-6);
  const lengths = recent.map(c => c.length);
  const lastCol = cols[cols.length - 1];
  const curLen  = lastCol.length;
  const curSide = lastCol[lastCol.length - 1][0];
  const oppSide = curSide === 'B' ? 'P' : 'B';

  if (curLen >= 5) return { name: 'Cau dai x' + curLen, betSide: curSide,  weight: 2.5 };
  if (curLen >= 3) return { name: 'Cau x'    + curLen,  betSide: curSide,  weight: 1.5 };
  if (lengths.every(x => x === 1)) return { name: 'Cau don', betSide: oppSide, weight: 2.5 };
  if (lengths.every(x => x === 2)) return { name: 'Cau doi', betSide: oppSide, weight: 2.0 };

  const alt12 = lengths.length >= 4 && lengths.every((x, i) => (i % 2 === 0 ? x === 1 : x === 2));
  const alt21 = lengths.length >= 4 && lengths.every((x, i) => (i % 2 === 0 ? x === 2 : x === 1));
  if (alt12 || alt21) {
    const nextLen = alt12 ? (cols.length % 2 === 0 ? 2 : 1) : (cols.length % 2 === 0 ? 1 : 2);
    return { name: alt12 ? 'Cau 1-2' : 'Cau 2-1', betSide: curLen < nextLen ? curSide : oppSide, weight: 2.0 };
  }
  if (lengths.every(x => x === 3)) return { name: 'Cau 3', betSide: oppSide, weight: 1.8 };

  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avg >= 2.8) return { name: 'Nghieng', betSide: curSide, weight: 1.2 };
  return { name: 'Hon hop', betSide: null, weight: 0 };
}

// ============================================
// TIE CYCLE
// ============================================
function checkTieCycle(raw) {
  const tPos = [];
  [...raw].forEach((x, i) => { if (x === 'T') tPos.push(i); });
  if (tPos.length < 3) return false;
  const gaps    = [];
  for (let i = 1; i < tPos.length; i++) gaps.push(tPos[i] - tPos[i - 1]);
  const avgGap  = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((a, b) => a + (b - avgGap) ** 2, 0) / gaps.length;
  if (variance > 4 || avgGap < 4 || avgGap > 16) return false;
  return Math.abs((raw.length - 1 - tPos[tPos.length - 1]) - avgGap) <= 2;
}

// ============================================
// NORMALIZE -> dai 55-88%
// ============================================
function normalize(rawScore) {
  const clamped = Math.max(50, Math.min(95, rawScore));
  return Math.round(55 + ((clamped - 50) / 45) * 33);
}

// ============================================
// ANALYZE
// ============================================
function analyze(oldData, newData) {
  let scoreB = 0, scoreP = 0;
  let beb = null, sr = null, cr = null;
  let cols = [];

  const raw = oldData
    ? (oldData.results || '').toUpperCase().replace(/[^BPT]/g, '')
    : '';

  if (raw.length >= 8) {
    cols = buildBigRoad(raw);
    const nonTie = [...raw].filter(x => x !== 'T');

    if (cols.length >= 3) {
      beb = predictFromDerived(cols, 1);
      sr  = predictFromDerived(cols, 2);
      cr  = predictFromDerived(cols, 3);
      if (beb === 'B') scoreB += 2.5; else if (beb === 'P') scoreP += 2.5;
      if (sr  === 'B') scoreB += 2.0; else if (sr  === 'P') scoreP += 2.0;
      if (cr  === 'B') scoreB += 1.5; else if (cr  === 'P') scoreP += 1.5;

      const pat = detectBigRoadPattern(cols);
      if (pat.betSide === 'B') scoreB += pat.weight;
      else if (pat.betSide === 'P') scoreP += pat.weight;

      const r20  = nonTie.slice(-20);
      const r20B = r20.filter(x => x === 'B').length;
      const r20P = r20.filter(x => x === 'P').length;
      const ratio = r20B / (r20B + r20P || 1);
      if (ratio > 0.62) scoreB += 1.2;
      else if (ratio < 0.38) scoreP += 1.2;
      else if (ratio > 0.55) scoreB += 0.5;
      else if (ratio < 0.45) scoreP += 0.5;

      const n = nonTie.length;
      if (n < 20  && ratio > 0.65) scoreB += 0.8;
      if (n < 20  && ratio < 0.35) scoreP += 0.8;
      if (n > 55  && ratio > 0.58) scoreB += 1.2;
      if (n > 55  && ratio < 0.42) scoreP += 1.2;

      if (checkTieCycle(raw)) return { dudoan: 'Hoa', ti_le: normalize(70) };

      const gr = (oldData.good_road || '').toString().toLowerCase();
      if (gr.includes('cai') || gr.includes('banker')) scoreB += 1.0;
      if (gr.includes('con') || gr.includes('player')) scoreP += 1.0;
    }
  }

  if (newData) {
    const last5 = (newData.last_5 || []).map(x => {
      const w = (x.winner || '').toLowerCase();
      return w === 'banker' ? 'B' : w === 'player' ? 'P' : 'T';
    }).filter(x => x !== 'T');

    const l5B = last5.filter(x => x === 'B').length;
    const l5P = last5.filter(x => x === 'P').length;
    if (l5B > l5P) scoreB += (l5B - l5P) * 0.4;
    else if (l5P > l5B) scoreP += (l5P - l5B) * 0.4;

    const stats   = newData.stats_55 || {};
    const total55 = (stats.banker || 0) + (stats.player || 0);
    if (total55 > 10) {
      const r55 = (stats.banker || 0) / total55;
      if (r55 > 0.60) scoreB += 1.0;
      else if (r55 < 0.40) scoreP += 1.0;
      else if (r55 > 0.53) scoreB += 0.4;
      else if (r55 < 0.47) scoreP += 0.4;
    }

    const recBet = (newData.recommended_bet || '').toUpperCase();
    if (recBet.includes('BANKER')) scoreB += 1.5;
    else if (recBet.includes('PLAYER')) scoreP += 1.5;

    const bkBet = (newData.bet_info || []).find(x => x.type === 'Banker');
    const plBet = (newData.bet_info || []).find(x => x.type === 'Player');
    if (bkBet && plBet) {
      const tot = (bkBet.amount || 0) + (plBet.amount || 0);
      if (tot > 0) {
        const cr2 = bkBet.amount / tot;
        if (cr2 > 0.68) scoreB += 0.8;
        else if (cr2 < 0.32) scoreP += 0.8;
      }
    }
  }

  if (scoreB === 0 && scoreP === 0) return { dudoan: 'Chua du du lieu', ti_le: 0 };

  const pred    = scoreB >= scoreP ? 'B' : 'P';
  const total   = scoreB + scoreP + 0.01;
  let rawScore  = (Math.max(scoreB, scoreP) / total) * 100;
  const drAgree = [beb, sr, cr].filter(x => x === pred).length;
  if (drAgree === 3) rawScore += 10;
  else if (drAgree === 2) rawScore += 5;

  return { dudoan: pred === 'B' ? 'Cai' : 'Con', ti_le: normalize(rawScore) };
}

// ============================================
// FETCH
// ============================================
async function safeFetch(url) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal:  controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// ============================================
// CACHE & STATS
// ============================================
let cache       = null;
let lastFetch   = 0;
let isFetching  = false;
let fetchCount  = 0;
let updateCount = 0;

// ============================================
// FETCH & DETECT NEW PHIEN
// Tra ve: true neu co phien moi
// ============================================
async function fetchAndCache() {
  if (isFetching) return false;
  isFetching  = true;
  fetchCount++;
  let hasNew  = false;

  try {
    const [oldResult, ...newResults] = await Promise.allSettled([
      safeFetch(API_OLD),
      ...BAN_IDS.map(id => safeFetch(API_NEW + '/' + id)),
    ]);

    const oldJson = oldResult.status === 'fulfilled' ? oldResult.value : null;

    const oldMap = {};
    if (oldJson && oldJson.code === 200 && Array.isArray(oldJson.data)) {
      for (const item of oldJson.data) {
        if (item.ban) oldMap[String(item.ban).trim()] = item;
      }
    }

    const newMap = {};
    for (let i = 0; i < BAN_IDS.length; i++) {
      const d = newResults[i] && newResults[i].status === 'fulfilled' ? newResults[i].value : null;
      if (!d) continue;
      const key = d.table ? String(d.table).trim() : BAN_IDS[i];
      newMap[key] = d;
    }

    const allBans  = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    const banList  = cache ? [...cache] : [];
    const banIndex = {};
    banList.forEach((b, i) => { banIndex[b.ban] = i; });

    for (const ban of allBans) {
      const oldData = oldMap[ban] || null;
      const newData = newMap[ban] || null;
      if (!oldData && !newData) continue;

      const curPhien   = newData ? (newData.phien != null ? newData.phien : null) : null;
      const curResults = oldData ? (oldData.results || null) : null;

      const phienChanged   = curPhien   !== null && curPhien   !== lastPhien.get(ban);
      const resultsChanged = curResults !== null && curResults !== lastResults.get(ban);

      if (!phienChanged && !resultsChanged) continue;

      if (phienChanged)   lastPhien.set(ban, curPhien);
      if (resultsChanged) lastResults.set(ban, curResults);
      hasNew = true;

      const hasNewData = newData && newData.last_5 && newData.last_5.length > 0;
      const hasOldData = (oldData && (oldData.results || '').length >= 8);
      if (!hasNewData && !hasOldData) continue;

      const a = analyze(oldData, newData);
      if (a.ti_le === 0) continue;

      const entry = {
        ban,
        phien:      curPhien,
        du_doan:    a.dudoan,
        do_tin_cay: a.ti_le + '%',
        updated_at: Date.now(),
      };

      if (ban in banIndex) {
        banList[banIndex[ban]] = entry;
      } else {
        banIndex[ban] = banList.length;
        banList.push(entry);
      }
    }

    banList.sort((a, b) =>
      String(a.ban).localeCompare(String(b.ban), undefined, { numeric: true })
    );

    cache     = banList;
    lastFetch = Date.now();

    if (hasNew) {
      updateCount++;
      const ts = new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      console.log('[' + ts + '] [PHIEN MOI #' + updateCount + '] ' + cache.length + ' ban | fetch #' + fetchCount);
    }
  } catch (err) {
    console.error('fetchAndCache error:', err.message);
  } finally {
    isFetching = false;
  }

  return hasNew;
}

// ============================================
// SMART POLLING LOOP
//
// - Khi khong co phien moi: poll moi POLL_ACTIVE (800ms)
//   de bat phien moi ngay khi xuat hien
// - Sau khi co phien moi: cho POLL_IDLE (3s) roi tiep tuc active
// - Neu lien tuc empty > 20 lan: tang len POLL_SLOWDOWN (2s) tranh spam
// ============================================
let consecutiveEmpty = 0;

async function smartLoop() {
  const t0     = Date.now();
  const hadNew = await fetchAndCache();
  const elapsed = Date.now() - t0;

  let wait;
  if (hadNew) {
    consecutiveEmpty = 0;
    wait = Math.max(0, POLL_IDLE - elapsed);
  } else {
    consecutiveEmpty++;
    if (consecutiveEmpty > 20) {
      wait = Math.max(0, POLL_SLOWDOWN - elapsed);
    } else {
      wait = Math.max(0, POLL_ACTIVE - elapsed);
    }
  }

  setTimeout(smartLoop, wait);
}

// ============================================
// HTTP SERVER
// ============================================
function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type':                'application/json; charset=utf-8',
    'Content-Length':              Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Cache-Control':               'no-cache',
  });
  res.end(body);
}

const server = http.createServer(function(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }

  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/api/bcr') {
    if (!cache) return sendJSON(res, 503, { loi: 'Chua co du lieu, thu lai sau' });
    return sendJSON(res, 200, {
      id:       '@sewdangcap',
      cap_nhat: new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      tong_ban: cache.length,
      du_lieu:  cache,
    });
  }

  const match = url.match(/^\/api\/bcr\/(.+)$/);
  if (req.method === 'GET' && match) {
    if (!cache) return sendJSON(res, 503, { loi: 'Chua co du lieu, thu lai sau' });
    const banId = decodeURIComponent(match[1]).trim();
    const item  = cache.find(function(x) { return String(x.ban).trim() === banId; });
    if (!item)  return sendJSON(res, 404, { loi: 'Khong tim thay ban: ' + banId });
    return sendJSON(res, 200, Object.assign({
      id:       '@sewdangcap',
      cap_nhat: new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
    }, item));
  }

  if (req.method === 'GET' && url === '/health') {
    return sendJSON(res, 200, {
      status:            'ok',
      cache_size:        cache ? cache.length : 0,
      fetching:          isFetching,
      fetch_count:       fetchCount,
      update_count:      updateCount,
      consecutive_empty: consecutiveEmpty,
      last_fetch_ago_ms: Date.now() - lastFetch,
      poll_mode:         consecutiveEmpty > 20 ? 'slowdown_2s' : consecutiveEmpty > 0 ? 'active_800ms' : 'just_updated',
    });
  }

  sendJSON(res, 404, { loi: 'Route khong ton tai' });
});

server.listen(PORT, function() {
  console.log('\n=== BACCARAT BOT v6 - Smart Polling ===');
  console.log('Server: http://localhost:' + PORT);
  console.log('Poll active  : ' + POLL_ACTIVE  + 'ms (cho phien moi)');
  console.log('Poll idle    : ' + POLL_IDLE    + 'ms (sau phien moi)');
  console.log('Poll slowdown: ' + POLL_SLOWDOWN + 'ms (khi khong co gi lau)');
  console.log('Fetch timeout: ' + FETCH_TIMEOUT + 'ms');
  console.log('Routes:');
  console.log('  GET /api/bcr        -> toan bo ban');
  console.log('  GET /api/bcr/:ban   -> mot ban cu the');
  console.log('  GET /health         -> trang thai poll\n');
  smartLoop();
});
