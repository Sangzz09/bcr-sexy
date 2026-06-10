// ============================================
// BACCARAT PREDICTOR v9 - @sewdangcap
// 3 APIs + 5 so do cau + good_road signal
// ============================================

const http  = require('http');
const fetch = require('node-fetch');

const API_HISTORY = 'https://lotus-resolved-shopzilla-acdbentity.trycloudflare.com/api/bcr';
const API_ALL     = 'https://pledge-bind-manufacturing-decimal.trycloudflare.com/api/bcr/all';
const API_BAN     = 'https://pledge-bind-manufacturing-decimal.trycloudflare.com/api/bcr/';
const PORT        = process.env.PORT || 3000;

const POLL_IDLE      = 3000;
const POLL_ACTIVE    = 800;
const POLL_SLOWDOWN  = 2000;
const FETCH_TIMEOUT  = 2500;

// ============================================
// ROAD ALGORITHMS
// ============================================

// Big Road: tach chuoi raw -> cot [[side,...],...]
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
      curCol  = [ch]; curSide = ch;
    } else {
      curCol.push(ch);
    }
  }
  if (curCol.length > 0) cols.push(curCol);
  return cols;
}

// Derived road (Big Eye=1, Small=2, Cockroach=3)
function buildDerived(cols, offset) {
  const out = [];
  for (let i = offset; i < cols.length; i++) {
    const cur = cols[i], ref = cols[i - offset];
    if (cur.length === 1 && ref.length === 1) { out.push('B'); continue; }
    const maxRow = Math.max(cur.length, ref.length);
    for (let r = 1; r < maxRow; r++) {
      const a = cur[r] ? cur[r][0] : null;
      const b = ref[r] ? ref[r][0] : null;
      if (!a && !b) continue;
      if (!a || !b) { out.push('B'); continue; }
      out.push(a === b ? 'R' : 'B');
    }
  }
  return out;
}

// Du doan tu derived: thu append moi phia, xem road them R hay B
function predictDerived(cols, offset) {
  if (cols.length < offset + 1) return null;
  const lastSide = cols[cols.length - 1].at(-1)[0];
  const oppSide  = lastSide === 'B' ? 'P' : 'B';

  const tryAppend = (side) => {
    const nc = cols.map(c => [...c]);
    if (side === lastSide) nc.at(-1).push(side);
    else nc.push([side]);
    const road = buildDerived(nc, offset);
    return road.at(-1) || null;
  };

  const ifSame = tryAppend(lastSide);
  const ifOpp  = tryAppend(oppSide);

  if (ifSame === 'R' && ifOpp === 'B') return lastSide;  // tiep dien
  if (ifSame === 'B' && ifOpp === 'R') return oppSide;   // doi

  // Fallback: xu huong duoi road
  const road = buildDerived(cols, offset);
  if (road.length < 3) return null;
  const tail = road.slice(-6);
  const rCnt = tail.filter(x => x === 'R').length;
  const bCnt = tail.filter(x => x === 'B').length;
  if (rCnt >= 4) return lastSide;
  if (bCnt >= 4) return oppSide;
  return null;
}

// Pattern Big Road
function detectPattern(cols) {
  if (cols.length < 2) return { side: null, w: 0, name: 'Chua ro' };
  const lens    = cols.slice(-8).map(c => c.length);
  const last    = cols.at(-1);
  const curSide = last.at(-1)[0];
  const opp     = curSide === 'B' ? 'P' : 'B';
  const curLen  = last.length;

  if (curLen >= 6) return { side: curSide, w: 3.0,  name: 'Cau dai ' + curLen };
  if (curLen >= 4) return { side: curSide, w: 2.0,  name: 'Cau x'   + curLen  };

  if (lens.length >= 4 && lens.every(x => x === 1))
    return { side: opp,     w: 2.5,  name: 'Cau don'  };
  if (lens.length >= 4 && lens.every(x => x === 2))
    return { side: curLen < 2 ? curSide : opp, w: 2.0, name: 'Cau doi' };
  if (lens.length >= 3 && lens.every(x => x === 3))
    return { side: curLen < 3 ? curSide : opp, w: 1.8, name: 'Cau ba'  };

  if (lens.length >= 4) {
    const is12 = lens.every((x, i) => i % 2 === 0 ? x === 1 : x === 2);
    const is21 = lens.every((x, i) => i % 2 === 0 ? x === 2 : x === 1);
    if (is12) {
      const nxt = cols.length % 2 === 0 ? 2 : 1;
      return { side: curLen < nxt ? curSide : opp, w: 2.0, name: 'Cau 1-2' };
    }
    if (is21) {
      const nxt = cols.length % 2 === 0 ? 1 : 2;
      return { side: curLen < nxt ? curSide : opp, w: 2.0, name: 'Cau 2-1' };
    }
    // 232, 323
    const is232 = lens.every((x, i) => [2,3,2,3,2,3,2,3][i % 4] === x || [3,2,3,2,3,2,3,2][i % 4] === x);
    if (lens.length >= 3) {
      const seq = lens.slice(-3);
      if ((seq[0]===2&&seq[1]===3&&seq[2]===2)||(seq[0]===3&&seq[1]===2&&seq[2]===3)) {
        const nxtLen = seq[2] === 2 ? 3 : 2;
        return { side: curLen < nxtLen ? curSide : opp, w: 1.8, name: 'Cau 232' };
      }
    }
  }

  const avg = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  if (avg >= 3.0) return { side: curSide, w: 1.2, name: 'Nghieng ' + curSide };
  return { side: null, w: 0, name: 'Hon hop' };
}

// Streak hien tai
function currentStreak(raw) {
  const bead = [...raw].filter(x => x !== 'T');
  if (!bead.length) return { side: null, len: 0 };
  const last = bead.at(-1);
  let len = 1;
  for (let i = bead.length - 2; i >= 0; i--) {
    if (bead[i] === last) len++; else break;
  }
  return { side: last, len };
}

// Bead stats
function beadStats(raw, n) {
  const bead = [...raw].filter(x => x !== 'T').slice(-n);
  const b = bead.filter(x => x === 'B').length;
  const p = bead.filter(x => x === 'P').length;
  return { b, p, total: b + p };
}

// Good road label -> signal
function goodRoadSignal(label) {
  if (!label) return { side: null, w: 0 };
  const l = label.toLowerCase();
  // Nghieng
  if (l.includes('nghiêng cái') || l.includes('nghieng cai') || l.includes('dính cái') || l.includes('dinh cai'))
    return { side: 'B', w: 1.5, name: label };
  if (l.includes('nghiêng con') || l.includes('nghieng con') || l.includes('dính con') || l.includes('dinh con'))
    return { side: 'P', w: 1.5, name: label };
  // Bet
  if (l.includes('bệt cái') || l.includes('bet cai'))
    return { side: 'B', w: 1.2, name: label };
  if (l.includes('bệt con') || l.includes('bet con'))
    return { side: 'P', w: 1.2, name: label };
  // Cau don -> zig-zag, du doan nguoc
  // (xu ly rieng trong analyze theo Big Road)
  return { side: null, w: 0 };
}

// Normalize -> 55..88
function normalize(raw) {
  const c = Math.max(50, Math.min(95, raw));
  return Math.round(55 + ((c - 50) / 45) * 33);
}

// Parse "BANKER (62.5% thắng)" -> {side, rate}
function parseAPISignal(str) {
  if (!str) return { side: null, rate: 0 };
  const ambig = str.match(/BANKER\s*\((\d+\.?\d*)%\)\s*-\s*PLAYER\s*\((\d+\.?\d*)%\)/i);
  if (ambig) {
    const b = parseFloat(ambig[1]), p = parseFloat(ambig[2]);
    return b >= p ? { side: 'B', rate: b } : { side: 'P', rate: p };
  }
  const m = str.match(/(BANKER|PLAYER)\s*\((\d+\.?\d*)%/i);
  if (!m) return { side: null, rate: 0 };
  return { side: m[1].toUpperCase() === 'BANKER' ? 'B' : 'P', rate: parseFloat(m[2]) };
}

// ============================================
// ANALYZE TONG HOP
// ============================================
function analyze(ban, rawHistory, goodRoad, apiAllItem, banDetail) {
  let scoreB = 0, scoreP = 0;
  const notes = [];

  const raw  = (rawHistory || '').toUpperCase().replace(/[^BPT]/g, '');
  const cols = buildBigRoad(raw);

  // --- 1. BIG ROAD pattern ---
  if (cols.length >= 2) {
    const pat = detectPattern(cols);
    if (pat.side === 'B') { scoreB += pat.w; notes.push(pat.name + '→Cai(' + pat.w + ')'); }
    else if (pat.side === 'P') { scoreP += pat.w; notes.push(pat.name + '→Con(' + pat.w + ')'); }
  }

  // --- 2. DERIVED ROADS ---
  if (cols.length >= 3) {
    const names  = ['BigEye', 'Small', 'Cock'];
    const weights = [2.5, 2.0, 1.5];
    [1, 2, 3].forEach((offset, i) => {
      const pred = predictDerived(cols, offset);
      if (pred === 'B') { scoreB += weights[i]; notes.push(names[i] + '→Cai'); }
      else if (pred === 'P') { scoreP += weights[i]; notes.push(names[i] + '→Con'); }
    });
  }

  // --- 3. BEAD stats ---
  if (raw.replace(/T/g, '').length >= 10) {
    const s20 = beadStats(raw, 20);
    const r   = s20.b / (s20.total || 1);
    if      (r > 0.62) { scoreB += 1.2; notes.push('Bead20 B=' + s20.b); }
    else if (r < 0.38) { scoreP += 1.2; notes.push('Bead20 P=' + s20.p); }
    else if (r > 0.55) { scoreB += 0.5; }
    else if (r < 0.45) { scoreP += 0.5; }
  }

  // --- 4. STREAK ---
  const streak = currentStreak(raw);
  if (streak.len >= 4) {
    const w = Math.min(streak.len * 0.3, 1.8);
    if (streak.side === 'B') { scoreB += w; notes.push('Streak Cai x' + streak.len); }
    else                     { scoreP += w; notes.push('Streak Con x' + streak.len); }
  } else if (streak.len === 1 && raw.length >= 4) {
    // zig-zag check
    const bead = [...raw].filter(x => x !== 'T');
    const tail4 = bead.slice(-4);
    const zigzag = tail4.length >= 3 && tail4.every((x, i) => i === 0 || x !== tail4[i - 1]);
    if (zigzag) {
      const opp = bead.at(-1) === 'B' ? 'P' : 'B';
      if (opp === 'B') { scoreB += 0.8; notes.push('Zigzag→Cai'); }
      else             { scoreP += 0.8; notes.push('Zigzag→Con'); }
    }
  }

  // --- 5. GOOD ROAD label ---
  const gr = goodRoadSignal(goodRoad);
  if (gr.side === 'B') { scoreB += gr.w; notes.push('GoodRoad:' + gr.name + '→Cai'); }
  else if (gr.side === 'P') { scoreP += gr.w; notes.push('GoodRoad:' + gr.name + '→Con'); }

  // Cau don: xu ly special - good_road bao "cau don" → zig-zag → dat nguoc streak
  if (goodRoad && goodRoad.toLowerCase().includes('đơn')) {
    const bead = [...raw].filter(x => x !== 'T');
    const last = bead.at(-1);
    const opp  = last === 'B' ? 'P' : 'B';
    if (opp === 'B') { scoreB += 1.5; notes.push('CauDon→Cai'); }
    else             { scoreP += 1.5; notes.push('CauDon→Con'); }
  }

  // --- 6. API /all signal ---
  if (apiAllItem) {
    const sig = parseAPISignal(apiAllItem.ket_qua_du_doan);
    if (sig.side === 'B') { scoreB += 2.0; notes.push('API→Cai(' + sig.rate + '%)'); }
    else if (sig.side === 'P') { scoreP += 2.0; notes.push('API→Con(' + sig.rate + '%)'); }
  }

  // --- 7. API /ban detail ---
  if (banDetail) {
    const rec = parseAPISignal(banDetail.recommended_bet || '');
    if (rec.side === 'B') { scoreB += 1.5; notes.push('Rec→Cai'); }
    else if (rec.side === 'P') { scoreP += 1.5; notes.push('Rec→Con'); }

    const st = banDetail.stats_55 || {};
    const tot55 = (st.banker || 0) + (st.player || 0);
    if (tot55 >= 15) {
      const r55 = st.banker / tot55;
      if (r55 > 0.60)      { scoreB += 1.0; notes.push('Stats55→Cai'); }
      else if (r55 < 0.40) { scoreP += 1.0; notes.push('Stats55→Con'); }
    }

    const l5 = (banDetail.last_5 || [])
      .map(x => x.winner === 'Banker' ? 'B' : x.winner === 'Player' ? 'P' : null)
      .filter(Boolean);
    const l5B = l5.filter(x => x === 'B').length;
    const l5P = l5.filter(x => x === 'P').length;
    const diff = l5B - l5P;
    if (diff > 0) scoreB += diff * 0.4;
    else if (diff < 0) scoreP += (-diff) * 0.4;

    const bkBet = (banDetail.bet_info || []).find(x => x.type === 'Banker');
    const plBet = (banDetail.bet_info || []).find(x => x.type === 'Player');
    if (bkBet && plBet) {
      const tot = (bkBet.amount || 0) + (plBet.amount || 0);
      if (tot > 0) {
        const cr = bkBet.amount / tot;
        if (cr > 0.68)      { scoreB += 0.8; notes.push('Crowd→Cai'); }
        else if (cr < 0.32) { scoreP += 0.8; notes.push('Crowd→Con'); }
      }
    }
  }

  if (scoreB === 0 && scoreP === 0)
    return { du_doan: 'Chua du du lieu', do_tin_cay: '0%', notes: [] };

  const pred  = scoreB >= scoreP ? 'B' : 'P';
  const total = scoreB + scoreP + 0.01;
  let rawScore = (Math.max(scoreB, scoreP) / total) * 100;

  // Bonus derived dong thuan
  const agree = [1,2,3].filter(o => predictDerived(cols,o) === pred).length;
  if (agree === 3) rawScore += 10;
  else if (agree === 2) rawScore += 5;

  return {
    du_doan:    pred === 'B' ? 'Cai' : 'Con',
    do_tin_cay: normalize(rawScore) + '%',
    notes,
  };
}

// ============================================
// FETCH
// ============================================
async function safeFetch(url) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: ctrl.signal,
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
let cache            = null;
let lastFetch        = 0;
let isFetching       = false;
let fetchCount       = 0;
let updateCount      = 0;
let consecutiveEmpty = 0;

const lastUpdateAt = new Map(); // ban -> update_at string tu history API

// ============================================
// FETCH & PROCESS
// ============================================
async function fetchAndCache() {
  if (isFetching) return false;
  isFetching = true;
  fetchCount++;
  let hasNew = false;

  try {
    // Fetch history + all song song
    const [histRes, allRes] = await Promise.allSettled([
      safeFetch(API_HISTORY),
      safeFetch(API_ALL),
    ]);

    const histJson = histRes.status === 'fulfilled' ? histRes.value : null;
    const allJson  = allRes.status  === 'fulfilled' ? allRes.value  : null;

    // Build maps
    const histMap = {};
    if (histJson && histJson.code === 200 && Array.isArray(histJson.data)) {
      for (const item of histJson.data) {
        const ban = String(item.ban).trim();
        histMap[ban] = item;
      }
    }

    const allMap = {};
    if (Array.isArray(allJson)) {
      for (const item of allJson) {
        const ban = String(item.ban).trim();
        allMap[ban] = item;
      }
    }

    // Tim ban co update moi (dua vao update_at cua history API)
    const newBans = [];
    for (const [ban, item] of Object.entries(histMap)) {
      if (item.update_at !== lastUpdateAt.get(ban)) {
        newBans.push(ban);
      }
    }
    // Them ban co trong allMap nhung khong co trong histMap
    for (const ban of Object.keys(allMap)) {
      if (!histMap[ban] && !newBans.includes(ban)) newBans.push(ban);
    }

    if (newBans.length === 0) { isFetching = false; return false; }

    // Fetch detail song song cho ban moi
    const detailResults = await Promise.allSettled(
      newBans.map(ban => safeFetch(API_BAN + encodeURIComponent(ban)))
    );

    const banList  = cache ? [...cache] : [];
    const banIndex = {};
    banList.forEach((b, i) => { banIndex[b.ban] = i; });

    for (let i = 0; i < newBans.length; i++) {
      const ban       = newBans[i];
      const histItem  = histMap[ban] || null;
      const allItem   = allMap[ban]  || null;
      const detail    = detailResults[i].status === 'fulfilled' ? detailResults[i].value : null;

      if (histItem) lastUpdateAt.set(ban, histItem.update_at);

      const rawHistory = histItem ? (histItem.results || '') : '';
      const goodRoad   = histItem ? (histItem.good_road || '') : '';

      const a = analyze(ban, rawHistory, goodRoad, allItem, detail);
      if (a.du_doan === 'Chua du du lieu') continue;

      const phien = allItem ? (allItem.phien || null) : (detail ? (detail.phien || null) : null);

      const entry = {
        ban,
        phien,
        du_doan:    a.du_doan,
        do_tin_cay: a.do_tin_cay,
        good_road:  goodRoad || '',
        notes:      a.notes,
        updated_at: Date.now(),
      };

      if (ban in banIndex) banList[banIndex[ban]] = entry;
      else { banIndex[ban] = banList.length; banList.push(entry); }

      hasNew = true;
    }

    banList.sort((a, b) =>
      String(a.ban).localeCompare(String(b.ban), undefined, { numeric: true })
    );

    cache     = banList;
    lastFetch = Date.now();

    if (hasNew) {
      updateCount++;
      const ts = new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      console.log('[' + ts + '] [UPDATE #' + updateCount + '] ' + newBans.length + ' ban | fetch #' + fetchCount);
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
// ============================================
async function smartLoop() {
  const t0      = Date.now();
  const hadNew  = await fetchAndCache();
  const elapsed = Date.now() - t0;

  let wait;
  if (hadNew) {
    consecutiveEmpty = 0;
    wait = Math.max(0, POLL_IDLE - elapsed);
  } else {
    consecutiveEmpty++;
    wait = Math.max(0, (consecutiveEmpty > 20 ? POLL_SLOWDOWN : POLL_ACTIVE) - elapsed);
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
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); return res.end();
  }

  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/api/bcr') {
    if (!cache) return sendJSON(res, 503, { loi: 'Chua co du lieu' });
    return sendJSON(res, 200, {
      id:       '@sewdangcap',
      cap_nhat: new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      tong_ban: cache.length,
      du_lieu:  cache,
    });
  }

  const match = url.match(/^\/api\/bcr\/(.+)$/);
  if (req.method === 'GET' && match) {
    if (!cache) return sendJSON(res, 503, { loi: 'Chua co du lieu' });
    const banId = decodeURIComponent(match[1]).trim();
    const item  = cache.find(x => String(x.ban).trim() === banId);
    if (!item)  return sendJSON(res, 404, { loi: 'Khong tim thay ban: ' + banId });
    return sendJSON(res, 200, {
      id:       '@sewdangcap',
      cap_nhat: new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      ...item,
    });
  }

  if (req.method === 'GET' && url === '/health') {
    return sendJSON(res, 200, {
      status:            'ok',
      cache_size:        cache ? cache.length : 0,
      fetch_count:       fetchCount,
      update_count:      updateCount,
      consecutive_empty: consecutiveEmpty,
      last_fetch_ago_ms: Date.now() - lastFetch,
      poll_mode:         consecutiveEmpty > 20 ? 'slowdown_2s' : 'active_800ms',
    });
  }

  sendJSON(res, 404, { loi: 'Route khong ton tai' });
});

server.listen(PORT, function() {
  console.log('\n=== BACCARAT BOT v9 - Full Road Analysis ===');
  console.log('History API : ' + API_HISTORY);
  console.log('Signal API  : ' + API_ALL);
  console.log('Detail API  : ' + API_BAN + ':ban');
  console.log('Thuat toan  : BigRoad + BigEye + SmallRoad + Cockroach + Bead + Streak + GoodRoad');
  console.log('Routes:');
  console.log('  GET /api/bcr        -> toan bo ban');
  console.log('  GET /api/bcr/:ban   -> chi tiet + notes');
  console.log('  GET /health         -> trang thai\n');
  smartLoop();
});
