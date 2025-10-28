// server.js
// Poll API Baccarat -> predictor -> lưu Firebase (JSON tiếng Việt + id @minhsangdangcap)
import fetch from "node-fetch";
import { predict } from "./predictor.js";

const FIREBASE_URL = process.env.FIREBASE_URL;
const API_URL = process.env.API_URL;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "5000", 10);
const TARGET_TABLES = (process.env.TARGET_TABLES || "C01,C02,C03,C04,C05,C06,C07,C08,C09,C10")
  .split(",").map(s=>s.trim()).filter(Boolean);
const DEBUG = !!(process.env.DEBUG && process.env.DEBUG !== "0");
const OWNER_ID = "@minhsangdangcap";

if (!FIREBASE_URL || !API_URL) {
  console.error("❌ Thiếu FIREBASE_URL hoặc API_URL trong biến môi trường.");
  process.exit(1);
}

function log(...args) {
  if (DEBUG) console.log(new Date().toISOString(), ...args);
}

// --- Hàm lấy dữ liệu Firebase ---
async function getFromFirebase(table) {
  try {
    const url = `${FIREBASE_URL.replace(/\/$/, "")}/bcr/${encodeURIComponent(table)}.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// --- Hàm lưu Firebase ---
async function saveToFirebase(table, payload) {
  try {
    const url = `${FIREBASE_URL.replace(/\/$/, "")}/bcr/${encodeURIComponent(table)}.json`;
    const res = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch {
    return false;
  }
}

// --- Chuẩn hóa dữ liệu API ---
function normalizeResponse(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (resp.data && Array.isArray(resp.data)) return resp.data;
  if (resp.results && Array.isArray(resp.results)) return resp.results;
  for (const k of Object.keys(resp || {}))
    if (Array.isArray(resp[k])) return resp[k];
  return [];
}

// --- Hàm chính gọi API ---
async function callApiOnce() {
  try {
    const res = await fetch(API_URL, { method: "GET" });
    if (!res.ok) {
      log("⚠️ API lỗi:", res.status, res.statusText);
      return;
    }
    const json = await res.json();
    const arr = normalizeResponse(json);
    if (!arr.length) {
      log("⚠️ API không trả dữ liệu hợp lệ.");
      return;
    }

    for (const item of arr) {
      const table = item.table_name || item.tableName || item.table;
      if (!table || !TARGET_TABLES.includes(table)) continue;

      const fb = await getFromFirebase(table);
      let history = [];
      if (fb && fb["Kết_quả"]) {
        const raw = fb["Kết_quả"];
        if (typeof raw === "string") history = raw.split(/[\s,|;]+/).filter(Boolean);
      }

      const resultStr = item.result || item.results || "";
      const tokens = resultStr.split(/[\s,|;]+/).filter(Boolean);
      if (tokens.length && (!history.length || history.at(-1) !== tokens.at(-1))) {
        history.push(tokens.at(-1));
      }

      const pred = await Promise.resolve(predict(history, { table }));
      const payload = {
        "Phiên": item.phien || null,
        "Kết_quả": resultStr,
        "Cầu": item.goodRoad || item.cau || "",
        "Dự_đoán": {
          "Kết_quả_dự_đoán": pred.prediction,
          "Độ_tin_cậy": pred.confidence,
          "Chi_tiết": pred.details,
          "Thời_gian": Date.now()
        },
        "id": OWNER_ID
      };

      const ok = await saveToFirebase(table, payload);
      if (ok)
        log(`✅ Lưu ${table} | dự đoán=${payload.Dự_đoán.Kết_quả_dự_đoán} | độ tin cậy=${payload.Dự_đoán.Độ_tin_cậy}%`);
      else
        log(`❌ Không thể lưu ${table}`);
    }
  } catch (err) {
    log("Lỗi API:", err.message);
  }
}

// --- Vòng lặp chính ---
(async function main() {
  log("🚀 Bắt đầu dịch vụ! API:", API_URL);
  while (true) {
    await callApiOnce();
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }
})();
