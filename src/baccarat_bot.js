// ============================================
// BACCARAT PREDICTOR v5 - @sewdangcap
// Fix: Big Road chuẩn, fetch nhanh hơn, thuật toán cải thiện
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
// BIG ROAD — chuẩn: không giới hạn chiều cao,
// chỉ wrap sang cột mới khi đổi side
// ============================================
function buildBigRoad(raw) {
  const cols   = [];
  let curSide  = null;
  let curCol   = [];

  for (const ch of raw) {
    if (ch === 'T') {
      // Tie gắn vào ô cuối cùng của cột hiện tại
      if (curCol.length > 0) {
        curCol[curCol.length - 1] += 'T';
      } else if (cols.length > 0) {
        const lc = cols[cols.length - 1];
        lc[lc.length - 1] += 'T';
      }
      continue;
    }

    if (ch !== curSide) {
      // Đổi side → push cột cũ, mở cột mới
      if (curCol.length > 0) cols.push(curCol);
      curCol  = [ch];
      curSide = ch;
    } else {
      // Cùng side → thêm vào cột hiện tại (không giới hạn chiều cao)
      curCol.push(ch);
    }
  }

  if (curCol.length > 0) cols.push(curCol);
  return cols;
}

// ============================================
// DERIVED ROADS (Bead Plate offset=1, Small Road offset=2, Cockroach offset=3)
// So sánh: cột hiện tại vs cột cách offset cột về trước
// R = cùng pattern, B = khác pattern
// ============================================
function derivedRoad(cols, offset) {
  const result = [];
  for (let i = offset; i < cols.length; i++) {
    const colCur  = cols[i];
    const colRef  = cols[i - offset];
    const maxRow  = Math.max(colCur.length, colRef.length);
    for (let row = 0; row < maxRow; row++) {
      const a = colCur[row] ? colCur[row][0] : null;
      const b = colRef[row] ? colRef[row][0] : null;
      if (a === null && b === null) continue;
      // Nếu một bên không có → khác (B)
      if (a === null || b === null) { result.push('B'); continue; }
      result.push(a === b ? 'R' : 'B');
    }
  }
  return result;
}

// Dự đoán từ derived road: thử append B hoặc P, xem ô mới sinh ra là R hay B
// → ưu tiên side nào làm derived road tiếp diễn (R)
function predictFromDerived(cols, offset) {
  if (cols.length < offset + 1) return null;

  const lastCol  = cols[cols.length - 1];
  const lastSide = lastCol[lastCol.length - 1][0]; // 'B' hoặc 'P'

  const tryAppend = (side) => {
    // Clone cols sâu vừa đủ
    const newCols = cols.map(c => [...c]);
    const lc      = newCols[newCols.length - 1];
    if (side === lastSide) {
      lc.push(side); // tiếp cột hiện tại
    } else {
      newCols.push([side]); // mở cột mới
    }
    const road = derivedRoad(newCols, offset);
    return road.length > 0 ? road[road.length - 1] : null;
  };

  const ifB = tryAppend('B');
  const ifP = tryAppend('P');

  // Nếu B → R và P → B: nên đặt B (tiếp diễn)
  if (ifB === 'R' && ifP === 'B') return 'B';
  // Nếu P → R và B → B: nên đặt P (tiếp diễn)
  if (ifP === 'R' && ifB === 'B') return 'P';

  // Cả hai đều R hoặc cả hai đều B → nhìn tail của road hiện tại
  const road = derivedRoad(cols, offset);
  if (road.length < 3) return null;
  const tail   = road.slice(-5);
  const rCount = tail.filter(x => x === 'R').length;
  const bCount = tail.filter(x => x === 'B').length;

  // Xu hướng mạnh → tiếp diễn xu hướng đó
  if (rCount >= 4) return lastSide;                            // đang chạy dài → tiếp
  if (bCount >= 4) return lastSide === 'B' ? 'P' : 'B';      // đang đảo liên tục → đảo
  return null;
}

// ============================================
// BIG ROAD PATTERN DETECTION
// Trả về { name, betSide: 'B'|'P'|null, weight }
// ============================================
function detectBigRoadPattern(cols) {
  if (cols.length < 3) return { name: 'Chua ro cau', betSide: null, weight: 0 };

  const recent  = cols.slice(-6);
  const lengths = recent.map(c => c.length);
  const lastCol = cols[cols.length - 1];
  const curLen  = lastCol.length;
  const curSide = lastCol[lastCol.length - 1][0];
  const oppSide = curSide === 'B' ? 'P' : 'B';

  // Cầu dài (Streak) — tiếp diễn
  if (curLen >= 5) return { name: `Cau dai x${curLen}`, betSide: curSide, weight: 2.5 };
  if (curLen >= 3) return { name: `Cau x${curLen}`,     betSide: curSide, weight: 1.5 };

  // Cầu 1 đôi — đảo liên tục
  if (lengths.every(x => x === 1)) return { name: 'Cau don', betSide: oppSide, weight: 2.5 };

  // Cầu đôi — đảo sau 2
  if (lengths.every(x => x === 2)) return { name: 'Cau doi', betSide: oppSide, weight: 2.0 };

  // Cầu 1-2 hoặc 2-1 (luân phiên)
  const alt12 = lengths.every((x, i) => (i % 2 === 0 ? x === 1 : x === 2));
  const alt21 = lengths.every((x, i) => (i % 2 === 0 ? x === 2 : x === 1));
  if (alt12 || alt21) {
    // Xác định next expected
    const nextLen = alt12
      ? (cols.length % 2 === 0 ? 2 : 1)
      : (cols.length % 2 === 0 ? 1 : 2);
    const side = curLen < nextLen ? curSide : oppSide;
    return { name: alt12 ? 'Cau 1-2' : 'Cau 2-1', betSide: side, weight: 2.0 };
  }

  // Cầu 3
  if (lengths.every(x => x === 3)) return { name: 'Cau 3', betSide: oppSide, weight: 1.8 };

  // Nghiêng về một bên (avg chiều cao cao)
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avg >= 2.8) return { name: 'Nghieng', betSide: curSide, weight: 1.2 };

  return { name: 'Hon hop', betSide: null, weight: 0 };
}

// ============================================
// RECENT RATIO (20 ván gần nhất, bỏ tie)
// ============================================
function recentRatio(nonTieArr) {
  const r20  = nonTieArr.slice(-20);
  const bCnt = r20.filter(x => x === 'B').length;
  const pCnt = r20.filter(x => x === 'P').length;
  const tot  = bCnt + pCnt || 1;
  return { ratio: bCnt / tot, bCnt, pCnt };
}

// ============================================
// SHOE POSITION BONUS
// Đầu shoe (< 20 ván): theo xu hướng mạnh
// Cuối shoe (> 55 ván): xu hướng càng rõ hơn
// ============================================
function shoeBonus(totalHands, ratio) {
  let bB = 0, bP = 0;
  if (totalHands < 20) {
    if (ratio > 0.65) bB += 0.8;
    else if (ratio < 0.35) bP += 0.8;
  }
  if (totalHands > 55) {
    if (ratio > 0.58) bB += 1.2;
    else if (ratio < 0.42) bP += 1.2;
  }
  return { bB, bP };
}

// ============================================
// TIE CYCLE — kiểm tra xem tie có chu kỳ đều không
// ============================================
function checkTieCycle(raw) {
  const tPos = [];
  [...raw].forEach((x, i) => { if (x === 'T') tPos.push(i); });
  if (tPos.length < 3) return false;

  const gaps    = [];
  for (let i = 1; i < tPos.length; i++) gaps.push(tPos[i] - tPos[i - 1]);
  const avgGap  = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const variance = gaps.reduce((a, b) => a + (b - avgGap) ** 2, 0) / gaps.length;

  // Chu kỳ đều (variance thấp) và khoảng cách hợp lý
  if (variance > 4 || avgGap < 4 || avgGap > 16) return false;

  const distFromLast = raw.length - 1 - tPos[tPos.length - 1];
  return Math.abs(distFromLast - avgGap) <= 2;
}

// ============================================
// NORMALIZE confidence về dải 55–88%
// Tránh over-confident (không bao giờ báo 99%)
// ============================================
function normalize(rawScore) {
  const clamped = Math.max(50, Math.min(95, rawScore));
  // Map [50, 95] → [55, 88]
  const mapped  = 55 + ((clamped - 50) / 45) * 33;
  return Math.round(mapped);
}

// ============================================
// ANALYZE — ghép voting từ tất cả signals
// ============================================
function analyze(oldData, newData) {
  // Scores: dương = B, âm = P
  let scoreB = 0, scoreP = 0;
  let beb = null, sr = null, cr = null;
  let cols = [];
  let nonTieArr = [];

  // ---------- SOURCE 1: API cũ (chuỗi kết quả) ----------
  const raw = oldData
    ? (oldData.results || '').toUpperCase().replace(/[^BPT]/g, '')
    : '';

  if (raw.length >= 8) {
    cols       = buildBigRoad(raw);
    nonTieArr  = [...raw].filter(x => x !== 'T');

    if (cols.length >= 3) {
      const lastCol  = cols[cols.length - 1];
      const curSide  = lastCol[lastCol.length - 1][0];

      // --- Derived roads (trọng số cao nhất) ---
      beb = predictFromDerived(cols, 1); // Bead plate
      sr  = predictFromDerived(cols, 2); // Small road
      cr  = predictFromDerived(cols, 3); // Cockroach road

      const drWeights = { beb: 2.5, sr: 2.0, cr: 1.5 };
      if (beb === 'B') scoreB += drWeights.beb; else if (beb === 'P') scoreP += drWeights.beb;
      if (sr  === 'B') scoreB += drWeights.sr;  else if (sr  === 'P') scoreP += drWeights.sr;
      if (cr  === 'B') scoreB += drWeights.cr;  else if (cr  === 'P') scoreP += drWeights.cr;

      // --- Big Road pattern ---
      const pattern = detectBigRoadPattern(cols);
      if (pattern.betSide === 'B') scoreB += pattern.weight;
      else if (pattern.betSide === 'P') scoreP += pattern.weight;

      // --- Recent ratio ---
      const { ratio } = recentRatio(nonTieArr);
      if (ratio > 0.62) scoreB += 1.2;
      else if (ratio < 0.38) scoreP += 1.2;
      else if (ratio > 0.55) scoreB += 0.5;
      else if (ratio < 0.45) scoreP += 0.5;

      // --- Shoe position ---
      const shoe = shoeBonus(nonTieArr.length, ratio);
      scoreB += shoe.bB;
      scoreP += shoe.bP;

      // --- Tie cycle ---
      if (checkTieCycle(raw)) {
        // Nếu dự đoán tie mạnh, trả luôn
        const tieConf = normalize(70);
        return { dudoan: 'Hòa', ti_le: tieConf };
      }

      // --- good_road hint từ API cũ ---
      const gr = (oldData.good_road || '').toString().toLowerCase();
      if (gr.includes('cái') || gr.includes('banker')) scoreB += 1.0;
      if (gr.includes('con') || gr.includes('player')) scoreP += 1.0;
    }
  }

  // ---------- SOURCE 2: API mới (stats) ----------
  if (newData) {
    const last5   = newData.last_5   || [];
    const stats   = newData.stats_55 || {};
    const recBet  = (newData.recommended_bet || '').toUpperCase();
    const betInfo = newData.bet_info || [];

    // Last 5 kết quả
    const l5results = last5.map(x => {
      const w = (x.winner || '').toLowerCase();
      if (w === 'banker') return 'B';
      if (w === 'player') return 'P';
      return 'T';
    }).filter(x => x !== 'T');

    const l5B = l5results.filter(x => x === 'B').length;
    const l5P = l5results.filter(x => x === 'P').length;
    // Trọng số thấp hơn vì chỉ 5 ván
    if (l5B > l5P) scoreB += (l5B - l5P) * 0.4;
    else if (l5P > l5B) scoreP += (l5P - l5B) * 0.4;

    // Stats 55 ván
    const total55 = (stats.banker || 0) + (stats.player || 0);
    if (total55 > 10) {
      const ratio55 = (stats.banker || 0) / total55;
      if (ratio55 > 0.60) scoreB += 1.0;
      else if (ratio55 < 0.40) scoreP += 1.0;
      else if (ratio55 > 0.53) scoreB += 0.4;
      else if (ratio55 < 0.47) scoreP += 0.4;
    }

    // Recommended bet từ API mới
    if (recBet.includes('BANKER')) scoreB += 1.5;
    else if (recBet.includes('PLAYER')) scoreP += 1.5;

    // Crowd bet ratio (tỷ lệ tiền đặt thực tế)
    const bkBet = betInfo.find(x => x.type === 'Banker');
    const plBet = betInfo.find(x => x.type === 'Player');
    if (bkBet && plBet) {
      const totalAmt = (bkBet.amount || 0) + (plBet.amount || 0);
      if (totalAmt > 0) {
        const crowdRatio = bkBet.amount / totalAmt;
        if (crowdRatio > 0.68) scoreB += 0.8;
        else if (crowdRatio < 0.32) scoreP += 0.8;
      }
    }
  }

  if (scoreB === 0 && scoreP === 0) return { dudoan: 'Chua du du lieu', ti_le: 0 };

  // ---------- Quyết định ----------
  const pred   = scoreB >= scoreP ? 'B' : 'P';
  const total  = scoreB + scoreP + 0.01;
  let rawScore = (Math.max(scoreB, scoreP) / total) * 100;

  // Bonus nếu derived roads đồng thuận
  const drAgree = [beb, sr, cr].filter(x => x === pred).length;
  if (drAgree === 3) rawScore += 10;
  else if (drAgree === 2) rawScore += 5;

  const tenViet = { B: 'Cái', P: 'Con' };
  return { dudoan: tenViet[pred], ti_le: normalize(rawScore) };
}

// ============================================
// FETCH — timeout ngắn, không retry ngầm,
// dùng Promise.allSettled để không bị chặn bởi 1 API chết
// ============================================
async function safeFetch(url, timeout = 2000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeout);
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
// CACHE
// ============================================
let cache     = null;
let lastFetch = 0;
let isFetching = false;

async function fetchAndCache() {
  if (isFetching) return; // chống fetch chồng nhau
  isFetching = true;

  try {
    // Tất cả fetch chạy SONG SONG, dùng allSettled nên 1 cái timeout
    // không block cái khác
    const allUrls = [
      API_OLD,
      ...BAN_IDS.map(id => `${API_NEW}/${id}`),
    ];

    const results = await Promise.allSettled(
      allUrls.map(url => safeFetch(url, 2000))
    );

    // Kết quả đầu tiên là API_OLD
    const oldJson    = results[0].status === 'fulfilled' ? results[0].value : null;
    const newResults = results.slice(1).map(r => r.status === 'fulfilled' ? r.value : null);

    // Build map từ API cũ
    const oldMap = {};
    if (oldJson && oldJson.code === 200 && Array.isArray(oldJson.data)) {
      for (const item of oldJson.data) {
        if (item.ban) oldMap[String(item.ban).trim()] = item;
      }
    }

    // Build map từ API mới
    const newMap = {};
    for (let i = 0; i < BAN_IDS.length; i++) {
      const d = newResults[i];
      if (!d) continue;
      const key = d.table ? String(d.table).trim() : BAN_IDS[i];
      newMap[key] = d;
    }

    const allBans = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
    const banList = [];

    for (const ban of allBans) {
      const oldData = oldMap[ban] || null;
      const newData = newMap[ban] || null;
      if (!oldData && !newData) continue;

      // Bỏ qua bàn không có đủ dữ liệu
      const hasNewData = newData && newData.last_5 && newData.last_5.length > 0;
      const hasOldData = oldData && (oldData.results || '').length >= 8;
      if (!hasNewData && !hasOldData) continue;

      const a = analyze(oldData, newData);
      if (a.ti_le === 0) continue;

      banList.push({
        ban:        ban,
        phien:      newData ? (newData.phien ?? null) : null,
        du_doan:    a.dudoan,
        do_tin_cay: `${a.ti_le}%`,
      });
    }

    banList.sort((a, b) =>
      String(a.ban).localeCompare(String(b.ban), undefined, { numeric: true })
    );

    cache     = banList;
    lastFetch = Date.now();

    const ts = new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    console.log(`[${ts}] Cap nhat ${cache.length} ban | old: ${Object.keys(oldMap).length} | new: ${Object.keys(newMap).length}`);
  } catch (err) {
    console.error('fetchAndCache error:', err.message);
  } finally {
    isFetching = false;
  }
}

// ============================================
// LOOP — bắt đầu fetch kế tiếp ngay sau khi xong,
// trừ đi thời gian đã dùng → không bao giờ drift
// ============================================
async function loop() {
  const t0 = Date.now();
  await fetchAndCache();
  const elapsed = Date.now() - t0;
  const wait    = Math.max(1000, INTERVAL - elapsed);
  setTimeout(loop, wait);
}

// ============================================
// HTTP SERVER
// ============================================
function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type':                 'application/json; charset=utf-8',
    'Content-Length':               Buffer.byteLength(body),
    'Access-Control-Allow-Origin':  '*',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }

  const url = req.url.split('?')[0];

  // GET /api/bcr — toàn bộ bàn
  if (req.method === 'GET' && url === '/api/bcr') {
    if (!cache) return sendJSON(res, 503, { loi: 'Chua co du lieu, thu lai sau' });
    return sendJSON(res, 200, {
      id:       '@sewdangcap',
      cap_nhat: new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      tong_ban: cache.length,
      du_lieu:  cache,
    });
  }

  // GET /api/bcr/:ban — một bàn cụ thể
  const match = url.match(/^\/api\/bcr\/(.+)$/);
  if (req.method === 'GET' && match) {
    if (!cache) return sendJSON(res, 503, { loi: 'Chua co du lieu, thu lai sau' });
    const banId = decodeURIComponent(match[1]).trim();
    const item  = cache.find(x => String(x.ban).trim() === banId);
    if (!item)  return sendJSON(res, 404, { loi: `Khong tim thay ban: ${banId}` });
    return sendJSON(res, 200, {
      id:       '@sewdangcap',
      cap_nhat: new Date(lastFetch).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      ...item,
    });
  }

  // GET /health
  if (req.method === 'GET' && url === '/health') {
    return sendJSON(res, 200, {
      status:   'ok',
      cache:    cache ? cache.length : 0,
      fetching: isFetching,
      last_fetch_ago_ms: Date.now() - lastFetch,
    });
  }

  sendJSON(res, 404, { loi: 'Route khong ton tai' });
});

server.listen(PORT, () => {
  console.log(`Server chay tai http://localhost:${PORT}`);
  console.log(`  GET /api/bcr        -> toan bo ban`);
  console.log(`  GET /api/bcr/:ban   -> mot ban cu the`);
  console.log(`  GET /health         -> trang thai server`);
  loop(); // bắt đầu vòng lặp fetch
});
