import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.XINYU_DB_PATH || process.env.VIBECHAT_DB_PATH || path.join(dataDir, "xinyu-piaoliu.sqlite");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  cabin_name TEXT UNIQUE NOT NULL,
  passcode_hash TEXT NOT NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  avatar_theme TEXT NOT NULL DEFAULT 'mist',
  updated_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS emotion_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  raw_text TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  mood_chips_json TEXT NOT NULL,
  intake_answers_json TEXT NOT NULL DEFAULT '{}',
  signal_strength INTEGER NOT NULL DEFAULT 35,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  viewer_account_id TEXT,
  partner_profile_json TEXT NOT NULL,
  match_basis_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(viewer_account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  sender_id TEXT,
  sender_type TEXT NOT NULL,
  sender_alias TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS echo_cards (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  room_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  saved INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  room_id TEXT,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
`);

const messageColumns = db.prepare("PRAGMA table_info(messages)").all().map((column) => column.name);
if (!messageColumns.includes("sender_id")) {
  db.exec("ALTER TABLE messages ADD COLUMN sender_id TEXT");
}

const accountColumns = db.prepare("PRAGMA table_info(accounts)").all().map((column) => column.name);
if (!accountColumns.includes("profile_json")) {
  db.exec("ALTER TABLE accounts ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}'");
}
if (!accountColumns.includes("avatar_theme")) {
  db.exec("ALTER TABLE accounts ADD COLUMN avatar_theme TEXT NOT NULL DEFAULT 'mist'");
}
if (!accountColumns.includes("updated_at")) {
  db.exec("ALTER TABLE accounts ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function now() {
  return Date.now();
}

function hashPasscode(passcode, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(passcode), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPasscode(passcode, stored) {
  const [salt, original] = String(stored || "").split(":");
  if (!salt || !original) return false;
  const candidate = hashPasscode(passcode, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(original, "hex"));
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    cabinName: row.cabin_name,
    profile: normalizeProfile(parseJson(row.profile_json, {})),
    avatarTheme: row.avatar_theme || "mist",
    updatedAt: row.updated_at || row.last_seen_at,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at
  };
}

function normalizeProfile(profile = {}) {
  return {
    mbti: String(profile.mbti || "").slice(0, 8),
    zodiac: String(profile.zodiac || "").slice(0, 12),
    selfIntro: String(profile.selfIntro || "").slice(0, 120),
    boundary: String(profile.boundary || "").slice(0, 120),
    publicFields: {
      mbti: Boolean(profile.publicFields?.mbti),
      zodiac: Boolean(profile.publicFields?.zodiac),
      selfIntro: profile.publicFields?.selfIntro !== false,
      boundary: profile.publicFields?.boundary !== false
    }
  };
}

export function createAccount(cabinName, passcode, profile = {}, avatarTheme = "mist") {
  const name = String(cabinName || "").trim().slice(0, 24);
  if (name.length < 2) {
    const error = new Error("cabin_name_too_short");
    error.code = "invalid_account";
    throw error;
  }
  if (String(passcode || "").length < 4) {
    const error = new Error("passcode_too_short");
    error.code = "invalid_passcode";
    throw error;
  }
  const account = {
    id: id("acct"),
    cabin_name: name,
    passcode_hash: hashPasscode(passcode),
    profile_json: JSON.stringify(normalizeProfile(profile)),
    avatar_theme: String(avatarTheme || "mist").slice(0, 24),
    updated_at: now(),
    created_at: now(),
    last_seen_at: now()
  };
  try {
    db.prepare("INSERT INTO accounts (id,cabin_name,passcode_hash,profile_json,avatar_theme,updated_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(account.id, account.cabin_name, account.passcode_hash, account.profile_json, account.avatar_theme, account.updated_at, account.created_at, account.last_seen_at);
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      const conflict = new Error("cabin_name_taken");
      conflict.code = "cabin_name_taken";
      throw conflict;
    }
    throw error;
  }
  return publicAccount(account);
}

export function loginAccount(cabinName, passcode) {
  const row = db.prepare("SELECT * FROM accounts WHERE cabin_name = ?").get(String(cabinName || "").trim());
  if (!row || !verifyPasscode(passcode, row.passcode_hash)) {
    const error = new Error("invalid_credentials");
    error.code = "invalid_credentials";
    throw error;
  }
  db.prepare("UPDATE accounts SET last_seen_at = ? WHERE id = ?").run(now(), row.id);
  return publicAccount({ ...row, last_seen_at: now() });
}

export function getAccount(accountId) {
  return publicAccount(db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId));
}

export function updateAccountProfile(accountId, profile, avatarTheme = "") {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
  if (!row) return null;
  const nextProfile = normalizeProfile({ ...parseJson(row.profile_json, {}), ...(profile || {}) });
  const nextTheme = String(avatarTheme || row.avatar_theme || "mist").slice(0, 24);
  const updatedAt = now();
  db.prepare("UPDATE accounts SET profile_json = ?, avatar_theme = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(nextProfile), nextTheme, updatedAt, accountId);
  return getAccount(accountId);
}

export function createEmotionEntry({ accountId, rawText, analysis, moodChips, signalStrength = 35 }) {
  const entry = {
    id: id("entry"),
    account_id: accountId || null,
    raw_text: String(rawText || ""),
    analysis_json: JSON.stringify(analysis || {}),
    mood_chips_json: JSON.stringify(moodChips || {}),
    intake_answers_json: "{}",
    signal_strength: signalStrength,
    created_at: now()
  };
  db.prepare(`
    INSERT INTO emotion_entries (id,account_id,raw_text,analysis_json,mood_chips_json,intake_answers_json,signal_strength,created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(entry.id, entry.account_id, entry.raw_text, entry.analysis_json, entry.mood_chips_json, entry.intake_answers_json, entry.signal_strength, entry.created_at);
  return publicEmotionEntry(entry);
}

export function updateEmotionEntryIntake(entryId, answers, signalStrength, analysis) {
  const current = getEmotionEntry(entryId);
  if (!current) return null;
  const nextAnalysis = analysis || current.analysis;
  db.prepare("UPDATE emotion_entries SET intake_answers_json = ?, signal_strength = ?, analysis_json = ? WHERE id = ?")
    .run(JSON.stringify(answers || {}), signalStrength, JSON.stringify(nextAnalysis), entryId);
  return getEmotionEntry(entryId);
}

export function getEmotionEntry(entryId) {
  const row = db.prepare("SELECT * FROM emotion_entries WHERE id = ?").get(entryId);
  return publicEmotionEntry(row);
}

export function listEmotionEntries(accountId, limit = 12) {
  return db.prepare("SELECT * FROM emotion_entries WHERE account_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(accountId, limit)
    .map(publicEmotionEntry);
}

function publicEmotionEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    rawText: row.raw_text,
    analysis: parseJson(row.analysis_json, {}),
    moodChips: parseJson(row.mood_chips_json, {}),
    intakeAnswers: parseJson(row.intake_answers_json, {}),
    signalStrength: row.signal_strength,
    createdAt: row.created_at
  };
}

export function saveRoom({ id: roomId, accountId, partner, matchBasis, status = "open" }) {
  db.prepare("INSERT OR REPLACE INTO rooms (id,viewer_account_id,partner_profile_json,match_basis_json,status,created_at) VALUES (?,?,?,?,?,?)")
    .run(roomId, accountId || null, JSON.stringify(partner || {}), JSON.stringify(matchBasis || {}), status, now());
}

export function getRoomRecord(roomId) {
  const row = db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.viewer_account_id,
    partner: parseJson(row.partner_profile_json, {}),
    matchBasis: parseJson(row.match_basis_json, {}),
    status: row.status,
    createdAt: row.created_at
  };
}

export function saveMessage({ id: messageId, roomId, senderId, senderType, senderAlias, text, createdAt }) {
  const existingRoom = roomId ? db.prepare("SELECT id FROM rooms WHERE id = ?").get(roomId) : null;
  if (!existingRoom) return;
  db.prepare("INSERT OR IGNORE INTO messages (id,room_id,sender_id,sender_type,sender_alias,text,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(messageId, roomId, senderId || null, senderType, senderAlias, text, createdAt || now());
}

export function listRoomMessages(roomId, viewerId = "") {
  return db.prepare("SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC").all(roomId).map((row) => ({
    id: row.id,
    roomId: row.room_id,
    senderId: row.sender_id,
    senderType: viewerId && row.sender_id ? (row.sender_id === viewerId ? "self" : "partner") : row.sender_type,
    senderAlias: row.sender_alias,
    text: row.text,
    createdAt: row.created_at
  }));
}

export function createEchoCard({ accountId, roomId, snapshot }) {
  const card = {
    id: id("echo"),
    account_id: accountId || null,
    room_id: roomId,
    snapshot_json: JSON.stringify(snapshot || {}),
    saved: 1,
    created_at: now()
  };
  db.prepare("INSERT INTO echo_cards (id,account_id,room_id,snapshot_json,saved,created_at) VALUES (?,?,?,?,?,?)")
    .run(card.id, card.account_id, card.room_id, card.snapshot_json, card.saved, card.created_at);
  return publicEchoCard(card);
}

export function listEchoCards(accountId) {
  return db.prepare("SELECT * FROM echo_cards WHERE account_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(accountId)
    .map(publicEchoCard);
}

function publicEchoCard(row) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.account_id,
    roomId: row.room_id,
    snapshot: parseJson(row.snapshot_json, {}),
    saved: Boolean(row.saved),
    createdAt: row.created_at
  };
}

export function createReport({ accountId, roomId, reason }) {
  const existingAccount = accountId ? db.prepare("SELECT id FROM accounts WHERE id = ?").get(accountId) : null;
  const existingRoom = roomId ? db.prepare("SELECT id FROM rooms WHERE id = ?").get(roomId) : null;
  const report = {
    id: id("report"),
    account_id: existingAccount ? accountId : null,
    room_id: existingRoom ? roomId : null,
    reason: String(reason || "安全边界提醒").slice(0, 200),
    created_at: now()
  };
  db.prepare("INSERT INTO reports (id,account_id,room_id,reason,created_at) VALUES (?,?,?,?,?)")
    .run(report.id, report.account_id, report.room_id, report.reason, report.created_at);
  return {
    id: report.id,
    accountId: report.account_id,
    roomId: report.room_id,
    reason: report.reason,
    createdAt: report.created_at
  };
}

export function resetDatabase() {
  db.exec("DELETE FROM reports; DELETE FROM echo_cards; DELETE FROM messages; DELETE FROM rooms; DELETE FROM emotion_entries; DELETE FROM accounts;");
}
