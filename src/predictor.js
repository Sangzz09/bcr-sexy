// predictor.js
// Thuật toán hybrid (Markov + tần suất + streak)
export function predict(history = [], opts = {}) {
  const win = history.filter(Boolean).slice(-60);
  if (!win.length)
    return { prediction: null, confidence: 0, details: { lý_do: "Không có lịch sử" } };

  const freq = {};
  for (const s of win) freq[s] = (freq[s] || 0) + 1;
  const total = win.length;

  const trans = {};
  for (let i = 0; i + 1 < win.length; i++) {
    const a = win[i],
      b = win[i + 1];
    trans[a] = trans[a] || {};
    trans[a][b] = (trans[a][b] || 0) + 1;
  }

  const last = win.at(-1);
  const row = trans[last] || {};
  const rowSum = Object.values(row).reduce((a, b) => a + b, 0);
  const transProb = {};
  for (const s of Object.keys(freq))
    transProb[s] = rowSum ? (row[s] || 0) / rowSum : 1 / Object.keys(freq).length;

  let streak = 1;
  for (let i = win.length - 1; i > 0; i--) {
    if (win[i] === win[i - 1]) streak++;
    else break;
  }
  const streakBoost = streak >= 3 ? 1 : 0;
  const streakVal = win.at(-1);

  const weights = { markov: 0.5, freq: 0.3, streak: 0.2 };
  const scores = {};
  for (const s of Object.keys(freq)) {
    const m = transProb[s] || 0;
    const f = freq[s] / total;
    const st = s === streakVal ? streakBoost : 0;
    scores[s] = weights.markov * m + weights.freq * f + weights.streak * st;
  }

  const sum = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  let best = null,
    bestv = -1;
  for (const s in scores) {
    scores[s] /= sum;
    if (scores[s] > bestv) (best = s), (bestv = scores[s]);
  }

  return {
    prediction: best,
    confidence: Math.round(bestv * 100),
    details: { điểm: scores, tần_suất: freq, streak: streak }
  };
}
export default predict;
