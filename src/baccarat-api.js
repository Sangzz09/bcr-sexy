// ============================================
// BACCARAT PREDICTOR v4 - @sewdangcap
// Big Road + Derived Roads + Trend Fallback
// node baccarat_bot.js
// ============================================

const fetch = require('node-fetch');

const API_URL = 'https://treasures-night-much-knowing.trycloudflare.com/api/bcr';
const INTERVAL = 30000;

// ============================================
// BIG ROAD
// ============================================
function buildBigRoad(raw) {
  const cols = []; let curSide = null, curCol = [];
  for (const ch of raw) {
    if (ch === 'T') {
      if (curCol.length > 0) curCol[curCol.length-1] += 'T';
      else if (cols.length > 0) { const lc = cols[cols.length-1]; lc[lc.length-1] += 'T'; }
      continue;
    }
    if (ch !== curSide) { if (curCol.length > 0) cols.push(curCol); curCol = [ch]; curSide = ch; }
    else { if (curCol.length < 6) curCol.push(ch); else { cols.push(curCol); curCol = [ch]; } }
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

// Dự đoán từ derived road:
// 1. Thử thêm B/P → xem kết quả mới là R hay B
// 2. Nếu không phân biệt → xem xu hướng cuối road (3 ký tự cuối)
function predictFromDerived(cols, offset) {
  if (cols.length < offset + 2) return null;

  const lastCol = cols[cols.length - 1];
  const lastSide = lastCol[lastCol.length - 1][0];

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

  // Tín hiệu rõ: một bên cho R, bên kia cho B
  if (ifB === 'R' && ifP === 'B') return 'B';
  if (ifP === 'R' && ifB === 'B') return 'P';

  // Không rõ → dùng xu hướng cuối road (momentum)
  const road = derivedRoad(cols, offset);
  if (road.length < 3) return null;
  const tail = road.slice(-4);
  const rCount = tail.filter(x => x === 'R').length;
  const bCount = tail.filter(x => x === 'B').length;

  // Nếu đang có chuỗi R (đều) → tiếp tục bên hiện tại
  if (rCount >= 3) return lastSide;
  // Nếu đang có chuỗi B (không đều) → đảo chiều
  if (bCount >= 3) return lastSide === 'B' ? 'P' : 'B';

  return null;
}

// ============================================
// BIG ROAD PATTERN
// ============================================
function detectBigRoadPattern(cols) {
  if (cols.length < 2) return { name: 'Chưa rõ cầu', score: {} };
  const lengths = cols.map(c => c.length).slice(-6);
  const curLen = cols[cols.length - 1].length;
  const n = lengths.length;

  if (lengths.every(x => x === 1)) return { name: 'Cầu đơn', score: { tiepTuc: 0, daoChieu: 3 } };
  if (lengths.every(x => x === 2)) return { name: 'Cầu đôi', score: { tiepTuc: 0, daoChieu: 3 } };
  if (curLen >= 6) return { name: `Bệt ×${curLen}`, score: { tiepTuc: -2, daoChieu: 4 } };
  if (curLen >= 4) return { name: `Bệt ×${curLen}`, score: { tiepTuc: 1.5, daoChieu: 0 } };

  let is12 = n >= 4;
  for (let i = 0; i < n && is12; i++) {
    if (i%2===0 && lengths[i]!==1) is12 = false;
    if (i%2===1 && lengths[i]!==2) is12 = false;
  }
  if (is12) return { name: 'Cầu 1-2', score: { tiepTuc: 2, daoChieu: 0 } };

  let is21 = n >= 4;
  for (let i = 0; i < n && is21; i++) {
    if (i%2===0 && lengths[i]!==2) is21 = false;
    if (i%2===1 && lengths[i]!==1) is21 = false;
  }
  if (is21) return { name: 'Cầu 2-1', score: { tiepTuc: 2, daoChieu: 0 } };

  // Cầu 3: BBBPPP
  if (lengths.every(x => x === 3)) return { name: 'Cầu 3', score: { tiepTuc: 0, daoChieu: 2.5 } };

  const avg = lengths.reduce((a,b)=>a+b,0)/lengths.length;
  if (avg > 2.8) return { name: 'Nghiêng bệt', score: { tiepTuc: 1.5, daoChieu: 0 } };

  return { name: 'Hỗn hợp', score: { tiepTuc: 0, daoChieu: 0 } };
}

// ============================================
// PHÂN TÍCH SHOE POSITION
// ============================================
function shoeBonus(raw, ratio, voteB, voteP) {
  const len = raw.length;
  let bB = 0, bP = 0;
  // Đầu shoe (<20 ván): ưu tiên theo xu hướng mạnh
  if (len < 20) {
    if (ratio > 0.65) bB += 1;
    else if (ratio < 0.35) bP += 1;
  }
  // Giữa shoe (20-55): balanced
  // Cuối shoe (>55): follow xu hướng mạnh hơn
  if (len > 55) {
    if (ratio > 0.55) bB += 1.5;
    else if (ratio < 0.45) bP += 1.5;
  }
  return { bB, bP };
}

// ============================================
// CHU KỲ HÒA
// ============================================
function checkTieCycle(seq) {
  const tPos = [];
  seq.forEach((x, i) => { if (x === 'T') tPos.push(i); });
  if (tPos.length < 2) return 0;
  const gaps = [];
  for (let i = 1; i < tPos.length; i++) gaps.push(tPos[i] - tPos[i-1]);
  const avgGap = gaps.reduce((a,b)=>a+b,0)/gaps.length;
  const distFromLast = seq.length - 1 - tPos[tPos.length-1];
  if (Math.abs(distFromLast - avgGap) <= 1.5 && avgGap >= 4 && avgGap <= 14) return 3;
  return 0;
}

// ============================================
// TỔNG HỢP DỰ ĐOÁN
// ============================================
function analyze(results, goodRoad) {
  const raw = results.toUpperCase().replace(/[^BPT]/g, '');
  if (raw.length < 6) return { dudoan: 'Chưa đủ dữ liệu', ti_le: 0 };

  const cols = buildBigRoad(raw);
  if (cols.length < 2) return { dudoan: 'Chưa đủ dữ liệu', ti_le: 0 };

  const lastCol  = cols[cols.length - 1];
  const curSide  = lastCol[lastCol.length - 1][0];
  const oppSide  = curSide === 'B' ? 'P' : 'B';

  const nonTie = raw.replace(/T/g, '').split('');
  let streak = 1;
  for (let i = nonTie.length - 2; i >= 0; i--) {
    if (nonTie[i] === nonTie[nonTie.length-1]) streak++; else break;
  }

  let voteB = 0, voteP = 0;

  // ── Tầng 1-3: Derived Roads (trọng số cao nhất) ──
  const beb = predictFromDerived(cols, 1); // Big Eye Boy  w=3.0
  const sr  = predictFromDerived(cols, 2); // Small Road   w=2.5
  const cr  = predictFromDerived(cols, 3); // Cockroach    w=2.0

  if (beb === 'B') voteB += 3.0; else if (beb === 'P') voteP += 3.0;
  if (sr  === 'B') voteB += 2.5; else if (sr  === 'P') voteP += 2.5;
  if (cr  === 'B') voteB += 2.0; else if (cr  === 'P') voteP += 2.0;

  // ── Tầng 4: Big Road Pattern ──
  const pattern = detectBigRoadPattern(cols);
  if ((pattern.score.tiepTuc || 0) > 0) {
    if (curSide === 'B') voteB += pattern.score.tiepTuc;
    else voteP += pattern.score.tiepTuc;
  }
  if ((pattern.score.daoChieu || 0) > 0) {
    if (oppSide === 'B') voteB += pattern.score.daoChieu;
    else voteP += pattern.score.daoChieu;
  }

  // ── Tầng 5: Tỉ lệ nghiêng 20 ván ──
  const r20 = nonTie.slice(-20);
  const r20B = r20.filter(x=>x==='B').length;
  const r20P = r20.filter(x=>x==='P').length;
  const ratio = r20B / (r20B + r20P || 1);
  if (ratio > 0.62) voteB += 1.5;
  else if (ratio < 0.38) voteP += 1.5;

  // ── Tầng 6: Shoe position ──
  const shoe = shoeBonus(raw, ratio, voteB, voteP);
  voteB += shoe.bB;
  voteP += shoe.bP;

  // ── Tầng 7: Chu kỳ Hòa ──
  const seq30 = raw.slice(-30).split('');
  const tieVote = checkTieCycle(seq30);

  // ── Tầng 8: Good road API ──
  if (goodRoad) {
    if (goodRoad.includes('Cái')) voteB += 1.5;
    if (goodRoad.includes('Con')) voteP += 1.5;
    if (goodRoad.includes('Hòa')) {}
  }

  // ── Quyết định ──
  const MAX_STREAK = 4;
  const tenViet = { B: 'Cái', P: 'Con', T: 'Hòa' };
  let pred, conf;

  if (tieVote >= 3 && tieVote > voteB && tieVote > voteP) {
    pred = 'T';
    conf = Math.min(Math.round((tieVote / (voteB + voteP + tieVote + 0.01)) * 100), 88);
  } else {
    // Giới hạn streak
    if (streak >= MAX_STREAK && voteB >= voteP && curSide === 'B') {
      pred = 'P'; conf = 62;
    } else if (streak >= MAX_STREAK && voteP >= voteB && curSide === 'P') {
      pred = 'B'; conf = 62;
    } else {
      pred = voteB >= voteP ? 'B' : 'P';
      const total = voteB + voteP + 0.01;
      conf = Math.min(Math.round((Math.max(voteB, voteP) / total) * 100), 95);

      // Boost nếu derived roads đồng thuận
      const agree = [beb, sr, cr].filter(x => x === pred).length;
      if (agree === 3) conf = Math.min(conf + 10, 95);
      else if (agree === 2) conf = Math.min(conf + 5, 95);
    }
  }

  return { dudoan: tenViet[pred], ti_le: conf };
}

// ============================================
// FETCH & OUTPUT JSON
// ============================================
let phien = 0;

async function fetchBaccarat() {
  phien++;
  const thoiGian = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric'
  });

  try {
    const res = await fetch(API_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
    });
    const json = await res.json();
    if (json.code !== 200 || !Array.isArray(json.data)) throw new Error('API lỗi');

    const banList = json.data
      .filter(x => x.results && x.results.length >= 4)
      .map(item => {
        const a = analyze(item.results, item.good_road);
        return {
          ban: item.ban,
          du_doan: a.dudoan,
          do_tin_cay: `${a.ti_le}%`,
        };
      });

    console.log('\n' + JSON.stringify({
      id: '@sewdangcap',
      phien,
      thoi_gian: thoiGian,
      du_lieu: banList,
    }, null, 2));

  } catch (err) {
    console.log('\n' + JSON.stringify({
      id: '@sewdangcap',
      phien,
      thoi_gian: thoiGian,
      loi: err.message,
    }, null, 2));
  }
}

fetchBaccarat();
setInterval(fetchBaccarat, INTERVAL);
