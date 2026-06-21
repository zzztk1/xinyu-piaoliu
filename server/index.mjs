import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "./env.mjs";
import { analyzeEmotion, generateCompanionReply, getProviderConfig } from "./provider.mjs";
import {
  createAccount,
  createEchoCard,
  createEmotionEntry,
  createReport,
  getAccount,
  getEmotionEntry,
  getRoomRecord,
  listEchoCards,
  listEmotionEntries,
  listRoomMessages,
  loginAccount,
  resetDatabase,
  updateAccountProfile,
  updateEmotionEntryIntake
} from "./db.mjs";
import { checkSafetyText } from "./safety.mjs";
import {
  addMessage,
  createReviewPartner,
  createUser,
  getRoomSnapshot,
  getMatchStatus,
  leaveRoom,
  listMessages,
  rematchUser,
  requestMatch,
  resetState,
  updateUserSignal
} from "./matching.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const indexHtmlPath = path.join(distDir, "index.html");
loadLocalEnv(rootDir);

const app = express();
app.use(cors());
app.use(express.json({ limit: "64kb" }));

function jsonOk(data = {}) {
  return { ok: true, errorType: null, ...data };
}

function jsonError(res, status, errorType, message, extra = {}) {
  return res.status(status).json({ ok: false, errorType, message, ...extra });
}

app.get("/api/health", (_req, res) => {
  const provider = getProviderConfig();
  res.json(jsonOk({
    service: "xinyu-piaoliu-api",
    providers: {
      stepfunOpenAI: provider.openai,
      stepfunAnthropic: provider.anthropic
    },
    model: provider.model,
    mode: provider.mode
  }));
});

app.post("/api/auth/register", (req, res) => {
  try {
    const account = createAccount(req.body?.cabinName, req.body?.passcode, req.body?.profile || {}, req.body?.avatarTheme || "mist");
    res.json(jsonOk({ account }));
  } catch (error) {
    if (error.code === "cabin_name_taken") {
      return jsonError(res, 409, "cabin_name_taken", "这个舱号已经被使用，请换一个名字，或切换到沿用已有舱号。");
    }
    const status = error.code === "cabin_name_taken" ? 409 : 400;
    jsonError(res, status, error.code || "auth_register_failed", "舱号不可用，请换一个名字或口令。");
  }
});

app.post("/api/auth/login", (req, res) => {
  try {
    const account = loginAccount(req.body?.cabinName, req.body?.passcode);
    res.json(jsonOk({ account }));
  } catch (error) {
    jsonError(res, 401, error.code || "invalid_credentials", "舱号或口令不匹配。");
  }
});

app.get("/api/me", (req, res) => {
  const account = getAccount(String(req.query.accountId || req.headers["x-account-id"] || ""));
  if (!account) return jsonError(res, 404, "account_not_found", "舱号不存在，请重新进入。");
  res.json(jsonOk({ account, echoCards: listEchoCards(account.id), emotionTrail: listEmotionEntries(account.id, 8) }));
});

app.patch("/api/profile", (req, res) => {
  const accountId = String(req.body?.accountId || "");
  const account = updateAccountProfile(accountId, req.body?.profile || {}, req.body?.avatarTheme || "");
  if (!account) return jsonError(res, 404, "account_not_found", "舱号不存在，请重新进入。");
  res.json(jsonOk({ account, echoCards: listEchoCards(account.id), emotionTrail: listEmotionEntries(account.id, 8) }));
});

app.post("/api/analyze", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  const providerStyle = req.body?.providerStyle === "anthropic" ? "anthropic" : "openai";
  const requestedAccountId = String(req.body?.accountId || "");
  const account = requestedAccountId ? getAccount(requestedAccountId) : null;
  if (requestedAccountId && !account) return jsonError(res, 404, "account_not_found", "舱号不存在，请重新进入。");
  const accountId = account ? requestedAccountId : "";
  const moodChips = req.body?.moodChips && typeof req.body.moodChips === "object" ? req.body.moodChips : {};
  if (text.length < 4) return jsonError(res, 400, "invalid_input", "请至少输入 4 个字，让系统理解你的状态。");
  if (text.length > 900) return jsonError(res, 413, "input_too_long", "这段心情太长了，请先压缩到 900 字以内。");
  const safety = checkSafetyText(text);
  if (!safety.ok) return jsonError(res, 422, "unsafe_text", safety.reason);

  try {
    const rawAnalysis = await analyzeEmotion(text, providerStyle);
    const analysis = withEmotionTheme(rawAnalysis, moodChips, text);
    const questions = buildFollowUpQuestions(analysis, moodChips, text);
    const signalStrength = baseSignalStrength(moodChips);
    const entry = createEmotionEntry({ accountId, rawText: text, analysis, moodChips, signalStrength });
    const user = createUser(analysis, "human", { accountId, entryId: entry.id, signalStrength: entry.signalStrength, profile: account?.profile, cabinName: account?.cabinName });
    res.json(jsonOk({
      user,
      analysis,
      entry,
      clarityScore: signalStrength,
      nextQuestion: questions[0] || null,
      emotionTheme: analysis.emotionTheme,
      driftIdentity: buildDriftIdentity(user, analysis),
      moodCoordinate: buildMoodCoordinate(analysis),
      signalTags: buildSignalTags(analysis, moodChips),
      followUpQuestions: questions,
      safetyBoundary: buildSafetyBoundary(analysis)
    }));
  } catch (error) {
    console.error("[analyze:error]", error);
    res.status(error.code === "provider_not_configured" ? 503 : 502).json({
      ok: false,
      errorType: error.code || "provider_failure",
      message: error.code === "provider_not_configured"
        ? "今晚的信号台还没接上，请稍后再试。"
        : "情绪分析暂时失败，请稍后重试。",
      providerStyle: error.providerStyle || providerStyle
    });
  }
});

app.post("/api/intake/complete", (req, res) => {
  const entryId = String(req.body?.entryId || "");
  const userId = String(req.body?.userId || "");
  const answers = req.body?.answers && typeof req.body.answers === "object" ? req.body.answers : {};
  const entry = getEmotionEntry(entryId);
  if (!entry) return jsonError(res, 404, "entry_not_found", "心情信号不存在，请重新投递。");
  const enriched = enrichAnalysisWithAnswers(entry.analysis, answers, entry.moodChips);
  const enrichedAnalysis = enriched.analysis;
  const signalStrength = signalStrengthFrom(entry.moodChips, answers);
  const updated = updateEmotionEntryIntake(entryId, answers, signalStrength, enrichedAnalysis);
  const updatedUser = userId ? updateUserSignal(userId, { entryId, analysis: enrichedAnalysis, signalStrength }) : null;
  res.json(jsonOk({
    entry: updated,
    analysis: enrichedAnalysis,
    user: updatedUser,
    signalStrength,
    clarityScore: signalStrength,
    nextQuestion: null,
    readyToMatch: signalStrength >= 75,
    emotionTheme: enrichedAnalysis.emotionTheme || emotionThemeFor(enrichedAnalysis, entry.moodChips, entry.rawText),
    dimensionChanges: enriched.dimensionChanges,
    tuningSummary: enriched.tuningSummary,
    matchHints: enriched.matchHints,
    precision: signalStrength >= 75 ? "clear" : "wide",
    moodCoordinate: buildMoodCoordinate(enrichedAnalysis),
    signalTags: buildSignalTags(enrichedAnalysis, entry.moodChips),
    safetyBoundary: buildSafetyBoundary(enrichedAnalysis)
  }));
});

app.post("/api/intake/answer", (req, res) => {
  const entryId = String(req.body?.entryId || "");
  const userId = String(req.body?.userId || "");
  const questionId = String(req.body?.questionId || "");
  const answer = req.body?.answer;
  const entry = getEmotionEntry(entryId);
  if (!entry) return jsonError(res, 404, "entry_not_found", "心情信号不存在，请重新投递。");
  if (!questionId || !answer) return jsonError(res, 400, "invalid_answer", "这一题还没有点亮。");
  const answers = { ...(entry.intakeAnswers || {}), [questionId]: answer };
  const enriched = enrichAnalysisWithAnswers(entry.analysis, answers, entry.moodChips);
  const enrichedAnalysis = withEmotionTheme(enriched.analysis, entry.moodChips, entry.rawText);
  const signalStrength = signalStrengthFrom(entry.moodChips, answers);
  const updated = updateEmotionEntryIntake(entryId, answers, signalStrength, enrichedAnalysis);
  const updatedUser = userId ? updateUserSignal(userId, { entryId, analysis: enrichedAnalysis, signalStrength }) : null;
  const questions = buildFollowUpQuestions(enrichedAnalysis, entry.moodChips, entry.rawText);
  const readyToMatch = signalStrength >= 80;
  const nextQuestion = readyToMatch ? null : questions.find((question) => !answers[question.id]) || null;
  res.json(jsonOk({
    entry: updated,
    analysis: enrichedAnalysis,
    user: updatedUser,
    signalStrength,
    clarityScore: signalStrength,
    dimensionChanges: enriched.dimensionChanges,
    tuningSummary: enriched.tuningSummary,
    matchHints: enriched.matchHints,
    nextQuestion,
    followUpQuestions: questions,
    questionHistory: answers,
    readyToMatch,
    emotionTheme: enrichedAnalysis.emotionTheme,
    moodCoordinate: buildMoodCoordinate(enrichedAnalysis),
    signalTags: buildSignalTags(enrichedAnalysis, entry.moodChips),
    safetyBoundary: buildSafetyBoundary(enrichedAnalysis)
  }));
});

app.post("/api/match/request", (req, res) => {
  const userId = String(req.body?.userId || "");
  const entryId = String(req.body?.entryId || "");
  const entry = entryId ? getEmotionEntry(entryId) : null;
  const result = requestMatch(userId, entry ? {
    entryId,
    analysis: entry.analysis,
    signalStrength: entry.signalStrength
  } : {});
  if (result.status === "not_found") return jsonError(res, 404, "user_not_found", "匿名身份不存在，请重新分析心情。");
  res.json(jsonOk(result));
});

app.get("/api/match/status", (req, res) => {
  const userId = String(req.query.userId || "");
  const result = getMatchStatus(userId);
  if (result.status === "not_found") return jsonError(res, 404, "user_not_found", "匿名身份不存在，请重新分析心情。");
  res.json(jsonOk(result));
});

app.post("/api/match/review-partner", (req, res) => {
  const userId = String(req.body?.userId || "");
  const result = createReviewPartner(userId);
  if (result.status === "not_found") return jsonError(res, 404, "user_not_found", "匿名身份不存在，请重新分析心情。");
  res.json(jsonOk(result));
});

app.post("/api/match/rematch", (req, res) => {
  const userId = String(req.body?.userId || "");
  const entryId = String(req.body?.entryId || "");
  const entry = entryId ? getEmotionEntry(entryId) : null;
  const result = rematchUser(userId, entry ? {
    entryId,
    analysis: entry.analysis,
    signalStrength: entry.signalStrength
  } : {});
  if (result.status === "not_found") return jsonError(res, 404, "user_not_found", "匿名身份不存在，请重新投递心情。");
  res.json(jsonOk(result));
});

app.post("/api/messages", async (req, res) => {
  const roomId = String(req.body?.roomId || "");
  const senderId = String(req.body?.senderId || "");
  const text = String(req.body?.text || "").trim();
  if (!text) return jsonError(res, 400, "invalid_message", "消息不能为空。");
  const safety = checkSafetyText(text);
  if (!safety.ok) return jsonError(res, 422, "unsafe_message", safety.reason);
  const message = await addMessage(roomId, senderId, text);
  if (!message) return jsonError(res, 404, "room_or_sender_not_found", "房间或匿名身份不可用。");
  res.json(jsonOk({ message }));
});

app.get("/api/messages", (req, res) => {
  const roomId = String(req.query.roomId || "");
  const viewerId = String(req.query.viewerId || "");
  const result = listMessages(roomId, viewerId);
  if (!result) return jsonError(res, 404, "room_or_viewer_not_found", "房间或匿名身份不可用。");
  res.json(jsonOk(result));
});

app.post("/api/rooms/leave", (req, res) => {
  const roomId = String(req.body?.roomId || "");
  const viewerId = String(req.body?.viewerId || "");
  const result = leaveRoom(roomId, viewerId);
  if (!result) return jsonError(res, 404, "room_or_viewer_not_found", "房间或匿名身份不可用。");
  res.json(jsonOk(result));
});

app.post("/api/echo-card", (req, res) => {
  const accountId = String(req.body?.accountId || "");
  const roomId = String(req.body?.roomId || "");
  const entryId = String(req.body?.entryId || "");
  const viewerId = String(req.body?.viewerId || "");
  if (!accountId || !roomId || !viewerId) {
    return jsonError(res, 400, "missing_echo_context", "回声瓶没有收好，请回到聊天里再试一次。");
  }
  const account = getAccount(accountId);
  if (!account) return jsonError(res, 404, "account_not_found", "舱号不存在，请重新进入。");
  const entry = getEmotionEntry(entryId);
  const liveSnapshot = viewerId ? getRoomSnapshot(roomId, viewerId) : null;
  const room = liveSnapshot?.room || getRoomRecord(roomId);
  if (!room) return jsonError(res, 404, "room_not_found", "这次相遇不可保存。");
  const messages = liveSnapshot?.messages || listRoomMessages(roomId, viewerId);
  const partner = liveSnapshot?.partner || room.partner || {};
  const matchBasis = liveSnapshot?.matchBasis || room.matchBasis || {};
  const partnerEcho = [...messages].reverse().find((message) => message.senderType === "partner")?.text || partner.selfIntro || "";
  const snapshot = {
    rawSignal: entry?.rawText || "",
    moodLabel: entry?.analysis?.label || "今晚的心情",
    sharedFrequency: matchBasis.sharedFrequency || 50,
    partnerAlias: partner.alias || "匿名对象",
    partnerEcho,
    messages: messages.map((message) => ({
      id: message.id,
      senderType: message.senderType,
      senderId: message.senderId,
      senderAlias: message.senderAlias,
      text: message.text,
      createdAt: message.createdAt
    })),
    matchReason: matchBasis.reason || "",
    signalTags: buildSignalTags(entry?.analysis || {}, entry?.moodChips || {}),
    createdAt: Date.now()
  };
  const echoCard = createEchoCard({ accountId, roomId, snapshot });
  res.json(jsonOk({ echoCard, echoCards: listEchoCards(accountId), emotionTrail: listEmotionEntries(accountId, 8) }));
});
app.get("/api/echo-cards", (req, res) => {
  const accountId = String(req.query.accountId || "");
  res.json(jsonOk({ echoCards: listEchoCards(accountId), emotionTrail: listEmotionEntries(accountId, 8) }));
});

app.post("/api/report", (req, res) => {
  const report = createReport({
    accountId: String(req.body?.accountId || ""),
    roomId: String(req.body?.roomId || ""),
    reason: String(req.body?.reason || "让我不舒服的内容")
  });
  res.json(jsonOk({ report, message: "已记录这次安全反馈。你可以继续留在这里，或换一束新的回声。" }));
});

app.post("/api/provider-check", async (req, res) => {
  const style = req.body?.style === "anthropic" ? "anthropic" : req.body?.style === "both" ? "both" : "openai";
  const styles = style === "both" ? ["openai", "anthropic"] : [style];
  const results = {};
  let failed = null;
  for (const item of styles) {
    try {
      const analysis = await analyzeEmotion("我今天有点紧张，但还是想和一个陌生人聊聊。", item);
      const reply = await generateCompanionReply({
        providerStyle: item,
        companion: {
          alias: "蓝港",
          selfIntro: "刚收拾完桌子，想随便聊几句。",
          privateProfile: "普通匿名用户，今晚状态轻微疲惫但愿意接话。",
          analysis: { dimensions: { calm: 62, energy: 42, social: 64, stress: 30, openness: 58, clarity: 56 } }
        },
        userAnalysis: analysis,
        message: "你刚刚做了什么事啊",
        history: [],
        replyCount: 0
      });
      results[item] = { analysisProviderStyle: analysis.providerStyle, replySample: reply };
    } catch (error) {
      failed = { style: item, error };
      break;
    }
  }
  if (failed) {
    const error = failed.error;
    return res.status(error.code === "provider_not_configured" ? 503 : 502).json({
      ok: false,
      errorType: error.code || "provider_failure",
      style: failed.style,
      message: error.message
    });
  }
  res.json(jsonOk({ style, results }));
});
app.post("/api/dev/reset", (_req, res) => {
  resetState();
  resetDatabase();
  res.json(jsonOk({ reset: true }));
});

app.use((error, req, res, next) => {
  if (!req.path.startsWith("/api")) return next(error);
  console.error("[api:error]", error);
  const isBodyParse = error.type === "entity.parse.failed";
  const status = isBodyParse ? 400 : Number(error.status || error.statusCode || 500);
  res.status(status).json({
    ok: false,
    errorType: isBodyParse ? "invalid_json" : error.code || "api_error",
    message: isBodyParse ? "信号格式没有对上，请刷新后再试一次。" : "信号台刚刚断了一下，请再试一次。"
  });
});

app.use("/api", (_req, res) => {
  jsonError(res, 404, "api_route_not_found", "API route not found.");
});

if (fs.existsSync(indexHtmlPath)) {
  app.use(express.static(distDir, {
    index: false,
    maxAge: "1h"
  }));

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    res.sendFile(indexHtmlPath);
  });
} else {
  app.get("/", (_req, res) => {
    jsonError(res, 503, "client_build_missing", "Client build missing. Run npm run build before starting production.");
  });
}

const port = Number(process.env.PORT || process.env.XINYU_PORT || process.env.VIBECHAT_PORT || 8787);
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () => {
  console.log(`心屿漂流 listening on http://${host}:${port}`);
});

function buildFollowUpQuestions(analysis, moodChips = {}, rawText = "") {
  const cluster = moodCluster(analysis, moodChips, rawText);
  const questionCopy = tuningQuestionCopy(cluster);
  return dimensionOrder.map((key) => ({
    id: key,
    dimension: dimensionLabelMap[key],
    prompt: questionCopy[key],
    options: tuningOptions[key].map((option) => ({ ...option }))
  }));
}

const dimensionOrder = ["calm", "energy", "social", "stress", "openness", "clarity"];
const dimensionLabelMap = {
  calm: "平静",
  energy: "能量",
  social: "社交",
  stress: "压力",
  openness: "开放",
  clarity: "清晰"
};

const tuningOptions = {
  calm: [
    { label: "脑子停不下来", dimensionDelta: { calm: -16, stress: 10, clarity: -4 } },
    { label: "身体松了一点", dimensionDelta: { calm: 14, stress: -10, energy: -2 } },
    { label: "开心到睡不着", dimensionDelta: { calm: -8, energy: 16, stress: -4 } },
    { label: "只是有点空", dimensionDelta: { calm: -4, social: -4, openness: 4 } },
    { label: "没什么波动", dimensionDelta: { calm: 8, stress: -6 } }
  ],
  energy: [
    { label: "低电量", dimensionDelta: { energy: -18, calm: 4, social: -6 } },
    { label: "还能认真聊", dimensionDelta: { energy: 8, clarity: 6, openness: 4 } },
    { label: "想分享很多", dimensionDelta: { energy: 16, social: 12, openness: 8 } },
    { label: "有点坐不住", dimensionDelta: { energy: 20, social: 10, calm: -8 } },
    { label: "先安静一会儿", dimensionDelta: { energy: -8, calm: 8, stress: -4 } }
  ],
  social: [
    { label: "多回应我一点", dimensionDelta: { social: 14, openness: 4 } },
    { label: "慢慢来就好", dimensionDelta: { social: 2, calm: 6, stress: -4 } },
    { label: "想一起吐槽", dimensionDelta: { social: 16, energy: 10, stress: -6 } },
    { label: "想一起高兴", dimensionDelta: { social: 18, energy: 12, stress: -8 } },
    { label: "别靠太近", dimensionDelta: { social: -14, openness: -8, calm: 4 } }
  ],
  stress: [
    { label: "事情压着我", dimensionDelta: { stress: 16, clarity: 4 } },
    { label: "怕结果落空", dimensionDelta: { stress: 10, clarity: -4, calm: -6 } },
    { label: "关系让我累", dimensionDelta: { stress: 14, social: 4, calm: -6 } },
    { label: "有点委屈", dimensionDelta: { stress: 16, social: -6, openness: -4 } },
    { label: "其实还好", dimensionDelta: { stress: -18, calm: 10 } }
  ],
  openness: [
    { label: "不聊隐私", dimensionDelta: { openness: -14, social: -4 } },
    { label: "可以讲细一点", dimensionDelta: { openness: 14, clarity: 8 } },
    { label: "只说开心的部分", dimensionDelta: { openness: 6, energy: 6, stress: -4 } },
    { label: "不想被建议", dimensionDelta: { openness: -8, calm: 4, stress: -4 } },
    { label: "可以轻松一点", dimensionDelta: { openness: 10, social: 8, energy: 4 } }
  ],
  clarity: [
    { label: "想说发生了什么", dimensionDelta: { clarity: 12, stress: -2 } },
    { label: "想说为什么开心", dimensionDelta: { clarity: 10, energy: 6, openness: 4 } },
    { label: "想说为什么难受", dimensionDelta: { clarity: 8, stress: 4, openness: 4 } },
    { label: "想弄清我想要什么", dimensionDelta: { clarity: 14, openness: 4 } },
    { label: "还是很乱", dimensionDelta: { clarity: -14, openness: 2, stress: 6 } }
  ]
};

function moodCluster(analysis = {}, moodChips = {}, rawText = "") {
  const haystack = String(rawText || "") + " " + String(analysis.primaryEmotion || "") + " " + String(analysis.label || "") + " " + (analysis.keywords || []).join(" ") + " " + Object.values(moodChips || {}).flat().join(" ");
  if (/开心|高兴|兴奋|期待|好事|庆祝|终于|激动|分享/.test(haystack) || Number(analysis.valence || 0) > 0.28) return "excited";
  if (/焦虑|紧张|压力|deadline|害怕|担心|烦躁|睡不着/.test(haystack)) return "anxious";
  if (/孤独|没人|空|房间|失联|陪|回应/.test(haystack)) return "lonely";
  if (/疲惫|累|困|低电量|没电|消耗|撑不住/.test(haystack)) return "tired";
  if (/生气|愤怒|火大|委屈|被误会|想骂/.test(haystack)) return "angry";
  if (/难过|失落|伤心|想哭|遗憾/.test(haystack)) return "sad";
  if (/乱|说不清|混|卡住|不确定/.test(haystack)) return "mixed";
  return "neutral";
}

function emotionThemeFor(analysis = {}, moodChips = {}, rawText = "") {
  const key = moodCluster(analysis, moodChips, rawText);
  const themes = {
    excited: { key, label: "亮潮", atmosphere: "兴奋、期待、想被接住", accent: "amber", motion: "spark" },
    sad: { key, label: "低潮", atmosphere: "难过、失落、需要轻声", accent: "blue", motion: "slow-ripple" },
    anxious: { key, label: "雾港", atmosphere: "焦虑、紧绷、需要降速", accent: "cyan", motion: "radar-soft" },
    tired: { key, label: "晚灯", atmosphere: "疲惫、低电量、需要少一点压力", accent: "moon", motion: "dim-pulse" },
    angry: { key, label: "冷火", atmosphere: "愤怒、委屈、需要安全释放", accent: "coral", motion: "short-flare" },
    lonely: { key, label: "空岸", atmosphere: "孤独、空落、需要回应", accent: "violet", motion: "distant-light" },
    mixed: { key, label: "乱流", atmosphere: "混乱、说不清、需要一点点整理", accent: "mint", motion: "drift" },
    neutral: { key, label: "静海", atmosphere: "未定、轻微波动、等待校准", accent: "cyan", motion: "drift" }
  };
  return themes[key] || themes.neutral;
}

function withEmotionTheme(analysis = {}, moodChips = {}, rawText = "") {
  return { ...analysis, emotionTheme: emotionThemeFor(analysis, moodChips, rawText) };
}

function tuningQuestionCopy(cluster) {
  const base = {
    calm: "刚才那段里，哪个念头最难停下来？",
    energy: "你现在还剩多少力气和人说话？",
    social: "你希望对方怎么靠近你？",
    stress: "这份感受最压着你的地方是哪一块？",
    openness: "今晚哪些边界要先留住？",
    clarity: "你更想先把哪件事说清楚？"
  };
  const copyByMood = {
    excited: {
      calm: "这份开心现在更像哪一种状态？",
      energy: "你是想立刻分享，还是只想有人接一下？",
      social: "你希望对方怎么陪你一起高兴？",
      stress: "这份开心里有没有夹着一点担心？",
      openness: "这件好事你愿意讲到哪一层？",
      clarity: "你最想先说清楚哪个开心的点？"
    },
    anxious: {
      calm: "最停不下来的那个念头是什么？",
      energy: "现在还能聊多久不觉得累？",
      stress: "压力主要压在哪个地方？",
      openness: "你现在最不想被碰到的边界是什么？",
      clarity: "如果只说一件事，你想先说哪件？"
    },
    lonely: {
      social: "今晚你更想要哪种回应？",
      openness: "你愿意让对方靠近到哪里？",
      calm: "安静下来的时候，最明显的感觉是什么？",
      clarity: "你是想说事，还是先确认有人在？"
    },
    tired: {
      energy: "今晚还剩多少聊天电量？",
      calm: "身体和脑子，哪个更累？",
      social: "你希望对方多说一点，还是少一点？",
      stress: "最消耗你的那一块是什么？"
    },
    angry: {
      stress: "这股火更靠近哪件事？",
      social: "你想被附和，还是想先骂两句？",
      openness: "哪些话题今晚先不要碰？",
      clarity: "这件事里最让你不舒服的是哪一下？"
    },
    sad: {
      openness: "这份难过你愿意说到哪一层？",
      clarity: "你想先讲发生了什么，还是讲现在的感受？",
      social: "你希望对方安静听，还是轻轻回应？",
      calm: "现在最沉的那一块在哪里？"
    },
    mixed: {
      clarity: "哪一块最说不清？",
      calm: "这团乱现在怎么转？",
      social: "你希望对方帮你理一理，还是只陪一会儿？",
      openness: "哪些部分还不想展开？"
    }
  };
  return { ...base, ...(copyByMood[cluster] || {}) };
}

function baseSignalStrength(moodChips) {
  const count = Object.values(moodChips || {}).flat().length;
  return Math.min(65, 35 + count * 6);
}

function signalStrengthFrom(moodChips, answers) {
  const chipCount = Object.values(moodChips || {}).flat().length;
  const answerCount = Object.values(answers || {}).filter(Boolean).length;
  return Math.min(96, 36 + chipCount * 5 + answerCount * 11);
}

function enrichAnalysisWithAnswers(analysis, answers, moodChips = {}) {
  const next = { ...analysis, dimensions: { ...(analysis.dimensions || {}) } };
  const dimensionChanges = Object.fromEntries(dimensionOrder.map((key) => [key, 0]));
  const answerLabels = [];
  for (const [dimension, answer] of Object.entries(answers || {})) {
    const label = optionLabel(answer);
    if (!label) continue;
    answerLabels.push(label);
    const delta = tuningDelta(dimension, label);
    for (const [key, amount] of Object.entries(delta)) {
      dimensionChanges[key] = Number(dimensionChanges[key] || 0) + amount;
      next.dimensions[key] = clampDimension(Number(next.dimensions[key] ?? 50) + amount);
    }
  }
  const chips = Object.values(moodChips || {}).flat().map(String);
  const quietBoundary = answerLabels.includes("不想被建议") || answerLabels.includes("不聊隐私") || chips.includes("不要建议");
  const celebrate = answerLabels.includes("一起庆祝") || answerLabels.includes("想分享很多") || answerLabels.includes("为什么开心");
  const closeEnough = answerLabels.includes("多回应我") || answerLabels.includes("可以讲细节");
  const matchHints = [];
  if (quietBoundary) matchHints.push("边界更清楚，适合不追问隐私、不急着给建议的停靠");
  if (celebrate) matchHints.push("能量和社交频段被点亮，适合能接住好消息的人");
  if (closeEnough) matchHints.push("回应需求更明确，适合回复节奏更积极的对象");
  if (answerLabels.includes("还是很乱")) matchHints.push("清晰度较低，破冰会先从小事实开始");
  if (answerLabels.includes("一起吐槽")) matchHints.push("适合轻微同盟感，不需要立刻解决问题");
  const changed = Object.entries(dimensionChanges).filter(([, value]) => value !== 0);
  const tuningSummary = changed.length
    ? `已校准 ${changed.map(([key, value]) => `${dimensionLabelMap[key]}${value > 0 ? "+" : ""}${value}`).join("、")}`
    : "保留原始心情坐标";
  next.dimensionChanges = dimensionChanges;
  next.intakeAnswers = answers;
  next.matchHints = matchHints;
  next.tuningSummary = tuningSummary;
  next.supportNeed = matchHints.length
    ? `${next.supportNeed || "需要低压交流"}；${matchHints.join("；")}。`
    : `${next.supportNeed || "需要低压交流"}；已根据补充答案校准匹配信号。`;
  next.keywords = [...new Set([...(next.keywords || []), ...answerLabels.slice(0, 3)])].slice(0, 8);
  if (celebrate) {
    next.matchStyle = "celebration-peer";
    next.primaryEmotion = next.primaryEmotion || "excited";
  }
  return { analysis: next, dimensionChanges, tuningSummary, matchHints };
}

function optionLabel(answer) {
  if (!answer) return "";
  if (typeof answer === "string") return answer;
  if (typeof answer === "object") return String(answer.label || "");
  return String(answer);
}

function tuningDelta(dimension, answer) {
  const options = tuningOptions[dimension] || [];
  const normalized = normalizeTuningAnswer(answer);
  const exact = options.find((option) => normalizeTuningAnswer(option.label) === normalized);
  if (exact) return exact.dimensionDelta;
  const fuzzy = options.find((option) => {
    const label = normalizeTuningAnswer(option.label);
    return label.includes(normalized) || normalized.includes(label);
  });
  if (fuzzy) return fuzzy.dimensionDelta;
  const aliases = {
    calm: [
      [/开心.*睡|睡不着|兴奋/, "开心到睡不着"],
      [/松|放下|缓过来/, "身体松了一点"],
      [/空|没波动/, "只是有点空"],
      [/停不下来|转个不停/, "脑子停不下来"]
    ],
    energy: [
      [/兴奋|想动|坐不住|劲很足/, "有点坐不住"],
      [/分享|说很多|好多话/, "想分享很多"],
      [/认真|能聊/, "还能认真聊"],
      [/安静|慢|先歇|一会/, "先安静一会儿"],
      [/低电|没电|很累/, "低电量"]
    ],
    social: [
      [/庆祝|高兴|一起开心/, "想一起高兴"],
      [/吐槽|骂两句/, "想一起吐槽"],
      [/回应|接住|多回/, "多回应我一点"],
      [/慢慢|不急/, "慢慢来就好"],
      [/别靠|距离|远一点/, "别靠太近"]
    ],
    stress: [
      [/没有|还好|不大|基本无/, "其实还好"],
      [/落空|搞砸|担心结果/, "怕结果落空"],
      [/关系|人际/, "关系让我累"],
      [/委屈|被忽略/, "有点委屈"],
      [/deadline|压|卡|事情/, "事情压着我"]
    ],
    openness: [
      [/开心|好事|只分享/, "只说开心的部分"],
      [/隐私|不聊/, "不聊隐私"],
      [/细|深入|讲清/, "可以讲细一点"],
      [/建议|别劝/, "不想被建议"],
      [/轻松|随便/, "可以轻松一点"]
    ],
    clarity: [
      [/开心|为什么高兴|好消息/, "想说为什么开心"],
      [/难受|为什么沉|低落/, "想说为什么难受"],
      [/想要|需要什么/, "想弄清我想要什么"],
      [/乱|说不清|混/, "还是很乱"],
      [/发生|经过|是什么事/, "想说发生了什么"]
    ]
  };
  const hit = (aliases[dimension] || []).find(([pattern]) => pattern.test(answer));
  if (!hit) return {};
  return options.find((option) => option.label === hit[1])?.dimensionDelta || {};
}

function normalizeTuningAnswer(answer) {
  return String(answer || "").replace(/[，。！？!?、,.…\s]/g, "").replace(/儿/g, "");
}
function clampDimension(value) {
  return Math.round(Math.min(96, Math.max(8, Number(value) || 50)));
}

function buildDriftIdentity(user, analysis) {
  return {
    alias: user.alias,
    avatar: user.avatar,
    title: `${analysis.label || "今晚心情"}漂流者`,
    cabinSignal: `SIG-${String(user.id).slice(-4).toUpperCase()}`
  };
}

function buildMoodCoordinate(analysis) {
  return {
    x: Math.round((Number(analysis.valence || 0) + 1) * 50),
    y: Math.round(Number(analysis.arousal || 0.5) * 100),
    label: analysis.label,
    intensity: analysis.intensity,
    dimensions: analysis.dimensions
  };
}

function buildSignalTags(analysis, moodChips) {
  const chips = Object.values(moodChips || {}).flat().map(String);
  return [...new Set([...(analysis.keywords || []), ...chips])].slice(0, 8);
}

function buildSafetyBoundary(analysis) {
  if (analysis.safetyFlag === "self_harm") return "这段信号可能已经超出普通聊天，请先联系身边可信的人或当地紧急支持。";
  if (Number(analysis.dimensions?.openness || 50) < 42) return "今晚只聊愿意公开的部分，不索要隐私，不舒服就离开。";
  return "保持匿名距离，不交换隐私；任何时候都可以离开或举报。";
}
