// ============================================
// BACCARAT SEXY API - @sewdangcap
// Nguồn: https://bacaratsexy0.hacksieucap.pro/api/ae
// ============================================

const fetch = require('node-fetch');

const API_URL = 'https://bacaratsexy0.hacksieucap.pro/api/ae';
const INTERVAL = 30000; // 30 giây

async function fetchBaccarat() {
  try {
    const res = await fetch(API_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const json = await res.json();

    if (json.status !== 'success') throw new Error('API trả về lỗi');

    const data = json.data.map(item => ({
      ban:      item.table,
      pattern:  item.pattern_detected,
      loai_cau: item.goodRoad || '–',
      dudoan:   item.dudoan,
      tile_win: item.tile_win,
      formula:  item.formula,
      bet:      item.bet_sizing?.suggestion,
      road:     item.road,
      time:     item.time,
    }));

    console.log(`[${new Date().toLocaleTimeString()}] ✅ ${data.length} bàn`);
    console.table(data.map(d => ({
      'Bàn':     d.ban,
      'Dự đoán': d.dudoan,
      'Loại cầu': d.loai_cau,
      'Pattern': d.pattern,
      'Tỉ lệ':   d.tile_win,
      'Cược':    d.bet,
    })));

    return data;

  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString()}] ❌ Lỗi: ${err.message}`);
    return null;
  }
}

// Chạy ngay lần đầu, sau đó lặp mỗi 30s
fetchBaccarat();
setInterval(fetchBaccarat, INTERVAL);
