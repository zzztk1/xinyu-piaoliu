import { generateCompanionReply } from "./provider.mjs";
import { saveMessage, saveRoom } from "./db.mjs";

const users = new Map();
const waiting = [];
const rooms = new Map();
const WAIT_WINDOW_MS = 5000;
const dimensionKeys = ["calm", "energy", "social", "stress", "openness", "clarity"];

const moodNames = {
  anxious: ["雾灯慢港", "青雾守夜", "定锚来客", "缓频小舟"],
  lonely: ["远灯听潮", "月台来信", "星港停靠", "夜泊回声"],
  sad: ["雨港旧灯", "蓝岸松针", "夜白小舟", "低潮旅人"],
  angry: ["赤潮止泊", "珊瑚暗火", "北风石桥", "冷泉压浪"],
  excited: ["朝阳星火", "晴野跃光", "金橙来客", "亮潮小艇"],
  calm: ["白茶浅湾", "林间晚风", "静泊灯塔", "温港来客"],
  tired: ["月白晚灯", "棉云慢舟", "银港停靠", "柔石夜航"],
  mixed: ["星雾微光", "蓝港栖木", "漂灯未央", "雾星来客"]
};

const companionPool = [
  {
    id: "partner-stable-listener",
    alias: "听澜",
    avatar: "澜",
    primaryEmotion: "anxious",
    selfIntro: "我这阵子在赶一个收尾项目，白天还算能撑住，晚上反而容易一直复盘。最近常出门慢走，让脑子别转得太快。",
    privateProfile: "自由项目执行者，近期处在收尾压力里。说话慢、克制，会从自己的复盘和散步习惯聊起，不以指导者姿态出现。",
    analysis: {
      primaryEmotion: "steady",
      label: "稳定陪伴",
      intensity: 2,
      valence: 0.18,
      arousal: 0.28,
      dimensions: { calm: 82, energy: 36, social: 62, stress: 18, openness: 66, clarity: 74 },
      keywords: ["稳定", "倾听", "降速"],
      matchStyle: "stable-listener",
      supportNeed: "适合焦虑、压力、混乱状态",
      rationale: "高平静度和高表达接纳度，适合接住焦虑型用户。",
      safetyFlag: "none"
    }
  },
  {
    id: "partner-warm-peer",
    alias: "南栀",
    avatar: "栀",
    primaryEmotion: "lonely",
    selfIntro: "我最近搬到了一个不太熟的地方，白天还好，晚上回去会突然觉得房间很安静。偶尔会想找人聊一点没那么重要的小事。",
    privateProfile: "自由插画师，刚搬到陌生城市。社交需求高但慢热，容易从房间、夜晚、小事和孤独感讲自己的状态。",
    analysis: {
      primaryEmotion: "warm",
      label: "温和共鸣",
      intensity: 3,
      valence: 0.26,
      arousal: 0.42,
      dimensions: { calm: 68, energy: 48, social: 78, stress: 22, openness: 82, clarity: 60 },
      keywords: ["共鸣", "陪伴", "轻聊天"],
      matchStyle: "warm-peer",
      supportNeed: "适合孤独、空落、想被回应的状态",
      rationale: "高社交需求和高开放度，能自然承接孤独感。",
      safetyFlag: "none"
    }
  },
  {
    id: "partner-energy-spark",
    alias: "青芒",
    avatar: "芒",
    primaryEmotion: "excited",
    selfIntro: "我今天刚把一个拖了很久的方案过掉，整个人有点飘，又怕开心劲过去以后落空。现在很想把这种兴奋找个地方放一下。",
    privateProfile: "活动策划人，刚完成阶段性目标。能量高、表达外放，但也有兴奋后的落空感，回复会带一点跳跃和庆祝感。",
    analysis: {
      primaryEmotion: "bright",
      label: "轻快回应",
      intensity: 4,
      valence: 0.55,
      arousal: 0.74,
      dimensions: { calm: 48, energy: 86, social: 76, stress: 24, openness: 80, clarity: 66 },
      keywords: ["兴奋", "庆祝", "期待"],
      matchStyle: "energy-spark",
      supportNeed: "适合开心、兴奋、想分享的状态",
      rationale: "高能量和高社交需求，适合陪用户分享好消息。",
      safetyFlag: "none"
    }
  },
  {
    id: "partner-clear-mirror",
    alias: "旧雨",
    avatar: "雨",
    primaryEmotion: "mixed",
    selfIntro: "我最近完成了一个阶段目标，本来该松口气，但心里反而有点杂，像开心、疲惫和不确定混在一起。现在还没太理清。",
    privateProfile: "产品经理，阶段性目标刚结束。清晰度较高但情绪复杂，会讲自己的复盘、空落和不确定，不扮演分析者。",
    analysis: {
      primaryEmotion: "clear",
      label: "清晰整理",
      intensity: 3,
      valence: 0.08,
      arousal: 0.44,
      dimensions: { calm: 70, energy: 50, social: 58, stress: 30, openness: 72, clarity: 88 },
      keywords: ["整理", "复述", "澄清"],
      matchStyle: "clear-mirror",
      supportNeed: "适合说不清、纠结、复合情绪",
      rationale: "高清晰度和高开放度，适合偏复杂的心情。",
      safetyFlag: "none"
    }
  }
];

export function resetState() {
  users.clear();
  waiting.splice(0, waiting.length);
  rooms.clear();
}

export function createUser(analysis, role = "human", extra = {}) {
  const identity = buildIdentity(analysis);
  const user = {
    id: `anon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    alias: identity.alias,
    avatar: identity.avatar,
    avatarTone: identity.avatarTone,
    role,
    background: role === "human" ? "匿名用户" : "",
    companionStyle: "",
    profile: extra.profile || {},
    selfIntro: publicSelfIntro(extra.profile),
    cabinName: extra.cabinName || "",
    analysis,
    accountId: extra.accountId || null,
    entryId: extra.entryId || null,
    signalStrength: extra.signalStrength || 35,
    roomId: null,
    createdAt: Date.now()
  };
  users.set(user.id, user);
  return publicUser(user);
}

export function updateUserSignal(userId, updates = {}) {
  const user = users.get(userId);
  if (!user) return null;
  if (updates.entryId) user.entryId = updates.entryId;
  if (updates.analysis) user.analysis = updates.analysis;
  if (updates.signalStrength) user.signalStrength = updates.signalStrength;
  return publicUser(user);
}

export function requestMatch(userId, options = {}) {
  const user = users.get(userId);
  if (!user) return { status: "not_found" };
  if (options.entryId) user.entryId = options.entryId;
  if (options.signalStrength) user.signalStrength = options.signalStrength;
  if (options.analysis) user.analysis = options.analysis;
  if (user.roomId && rooms.has(user.roomId)) return { status: "matched", room: publicRoom(rooms.get(user.roomId), userId) };

  removeStaleWaiting();
  const candidate = findCandidate(user);
  if (candidate) {
    removeWaiting(candidate.id);
    removeWaiting(user.id);
    const room = createRoom(user, candidate);
    return { status: "matched", room: publicRoom(room, userId) };
  }

  if (!options.forceFallback) {
    addWaiting(user);
    return { status: "waiting", user: publicUser(user), waitUntil: user.waitingSince + WAIT_WINDOW_MS };
  }

  removeWaiting(user.id);
  const companion = createCompanionFor(user.analysis);
  const room = createRoom(user, companion);
  addSystemMessage(room, companion, firstCompanionLine(companion, user.analysis));
  return { status: "matched", room: publicRoom(room, userId), source: companion.dynamic ? "adaptive-partner" : "partner-pool" };
}

export function getMatchStatus(userId) {
  const user = users.get(userId);
  if (!user) return { status: "not_found" };
  if (!user.roomId) {
    removeStaleWaiting(user.id);
    const candidate = findCandidate(user);
    if (candidate) {
      removeWaiting(candidate.id);
      removeWaiting(user.id);
      const room = createRoom(user, candidate);
      return { status: "matched", room: publicRoom(room, userId) };
    }
    if (user.waitingSince && Date.now() - user.waitingSince >= WAIT_WINDOW_MS) {
      return requestMatch(userId, { forceFallback: true });
    }
    addWaiting(user);
    return { status: "waiting", user: publicUser(user), waitUntil: user.waitingSince + WAIT_WINDOW_MS };
  }
  const room = rooms.get(user.roomId);
  return room ? { status: "matched", room: publicRoom(room, userId) } : { status: "waiting", user: publicUser(user) };
}

export function createReviewPartner(userId) {
  return requestMatch(userId, { forceFallback: true });
}

export function rematchUser(userId, options = {}) {
  const user = users.get(userId);
  if (!user) return { status: "not_found" };
  const currentRoomId = user.roomId;
  if (currentRoomId) {
    const room = rooms.get(currentRoomId);
    if (room) {
      room.status = "rematched";
      room.partnerStatus = "left";
      room.typingParticipantId = null;
      room.pendingReply = false;
      room.lastActivityAt = Date.now();
    }
  }
  user.roomId = null;
  user.waitingSince = null;
  if (options.entryId) user.entryId = options.entryId;
  if (options.signalStrength) user.signalStrength = options.signalStrength;
  if (options.analysis) user.analysis = options.analysis;
  removeWaiting(user.id);
  return requestMatch(userId, { ...options, forceFallback: Boolean(options.forceFallback) });
}

export async function addMessage(roomId, senderId, text) {
  const room = rooms.get(roomId);
  const sender = users.get(senderId);
  if (!room || !sender || !room.participantIds.includes(senderId)) return null;
  if (room.status !== "open") return null;
  const body = String(text || "").trim();
  if (!body) return null;

  const message = pushMessage(room, sender, body);
  const companion = room.participantIds.map((id) => users.get(id)).find((u) => u?.role === "ai-companion");
  if (companion && sender.id !== companion.id) {
    const human = room.participantIds.map((id) => users.get(id)).find((u) => u?.role === "human");
    scheduleCompanionReply(room, companion, human || sender, body);
  }
  return message;
}

export function listMessages(roomId, viewerId) {
  const room = rooms.get(roomId);
  if (!room || !room.participantIds.includes(viewerId)) return null;
  return {
    messages: room.messages.map((message) => ({
      ...message,
      mine: message.senderId === viewerId
    })),
    typing: Boolean(room.typingParticipantId && room.typingParticipantId !== viewerId),
    roomStatus: room.status,
    partnerStatus: room.partnerStatus,
    lastActivityAt: room.lastActivityAt
  };
}

export function leaveRoom(roomId, viewerId) {
  const room = rooms.get(roomId);
  if (!room || !room.participantIds.includes(viewerId)) return null;
  room.status = "left";
  room.partnerStatus = "left";
  room.typingParticipantId = null;
  room.pendingReply = false;
  room.lastActivityAt = Date.now();
  const viewer = users.get(viewerId);
  if (viewer) {
    viewer.roomId = null;
    viewer.waitingSince = null;
  }
  removeWaiting(viewerId);
  return {
    roomStatus: room.status,
    partnerStatus: room.partnerStatus,
    lastActivityAt: room.lastActivityAt
  };
}

export function getRoomSnapshot(roomId, viewerId) {
  const room = rooms.get(roomId);
  if (!room || !room.participantIds.includes(viewerId)) return null;
  const partnerId = room.participantIds.find((id) => id !== viewerId);
  const partner = users.get(partnerId);
  return {
    room: publicRoom(room, viewerId),
    partner: partner ? publicUser(partner) : null,
    matchBasis: room.matchBasis,
    messages: room.messages.map((message) => ({
      id: message.id,
      roomId: message.roomId,
      senderId: message.senderId,
      senderType: message.senderId === viewerId ? "self" : "partner",
      senderAlias: message.senderAlias,
      text: message.text,
      createdAt: message.createdAt
    }))
  };
}

function createCompanionFor(analysis) {
  const best = selectBestCompanion(analysis);
  const shouldGenerate = compatibility({ analysis }, { analysis: best.analysis }) < 0.55 || Number(analysis.dimensions?.clarity || 50) < 35;
  const template = shouldGenerate ? buildDynamicCompanion(analysis) : best;
  const shapedAnalysis = shapeCompanionAnalysis(analysis, template.analysis, template.primaryEmotion || "mixed");
  const alias = themedAlias(template.alias, shapedAnalysis);
  const companion = {
    id: `anon_partner_${template.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    alias,
    avatar: template.avatar,
    avatarTone: avatarTone(shapedAnalysis),
    role: "ai-companion",
    selfIntro: buildPartnerStory(template, shapedAnalysis),
    privateProfile: template.privateProfile,
    analysis: shapedAnalysis,
    dynamic: Boolean(template.dynamic),
    roomId: null,
    createdAt: Date.now()
  };
  users.set(companion.id, companion);
  return companion;
}

function selectBestCompanion(analysis) {
  let best = companionPool[0];
  let bestScore = -Infinity;
  for (const companion of companionPool) {
    const score = compatibility({ analysis }, { analysis: companion.analysis });
    if (score > bestScore) {
      best = companion;
      bestScore = score;
    }
  }
  return best;
}

function buildDynamicCompanion(analysis) {
  const calmNeed = Number(analysis.dimensions?.stress || 50) > 70;
  const alias = themedAlias(calmNeed ? "半夏静港" : Number(analysis.dimensions?.social || 50) > 70 ? "听雨来客" : "远青灯塔", analysis);
  return {
    id: "dynamic-companion",
    alias,
    avatar: alias.slice(0, 1),
    dynamic: true,
    selfIntro: calmNeed
      ? "我这两天也有点被事情压住，越到晚上越容易把细节翻出来想一遍。其实没有发生什么大事，但身体一直绷着。"
      : "我最近有点说不清自己的状态，白天像没事，安静下来又觉得心里有东西没落地。所以想找个陌生人随便交换几句。",
    privateProfile: calmNeed
      ? "处在压力期的普通匿名用户，夜间复盘多、身体紧绷。回复从自己的压力体验出发。"
      : "复合情绪中的普通匿名用户，白天正常、安静后情绪浮现。回复从自己的未落地感出发。",
    analysis: {
      primaryEmotion: "adaptive",
      label: calmNeed ? "安定型陪伴" : "适配型陪伴",
      intensity: 3,
      valence: Math.min(0.45, Number(analysis.valence || 0) + 0.42),
      arousal: calmNeed ? 0.28 : 0.46,
      dimensions: {
        calm: calmNeed ? 86 : 68,
        energy: calmNeed ? 34 : 54,
        social: Math.max(58, Number(analysis.dimensions?.social || 50)),
        stress: 18,
        openness: 76,
        clarity: 72
      },
      keywords: calmNeed ? ["安定", "降压", "陪伴"] : ["适配", "共鸣", "破冰"],
      matchStyle: "adaptive-companion",
      supportNeed: "适配偏门或复合情绪",
      rationale: "根据用户当前维度动态生成，避免没有合适对象时卡在等待。",
      safetyFlag: "none"
    }
  };
}

function shapeCompanionAnalysis(userAnalysis, templateAnalysis, primaryEmotion) {
  const userDims = userAnalysis.dimensions || {};
  const templateDims = templateAnalysis.dimensions || {};
  const farKeys = chooseFarDimensions(userAnalysis, primaryEmotion);
  const closeKeys = dimensionKeys.filter((key) => !farKeys.includes(key));
  const dimensions = {};
  for (const key of dimensionKeys) {
    const userValue = Number(userDims[key] ?? 50);
    const templateValue = Number(templateDims[key] ?? 50);
    const seed = hashText(`${userAnalysis.inputHash || userAnalysis.label}:${key}:${primaryEmotion}`) % 9 - 4;
    if (closeKeys.includes(key)) {
      dimensions[key] = clamp(Math.round(userValue + seed), 8, 96);
    } else {
      const direction = templateValue >= userValue ? 1 : -1;
      const fallbackDirection = userValue < 50 ? 1 : -1;
      const farDirection = Math.abs(templateValue - userValue) >= 28 ? direction : fallbackDirection;
      dimensions[key] = clamp(Math.round(userValue + farDirection * (34 + Math.abs(seed))), 8, 96);
    }
  }
  return {
    ...templateAnalysis,
    id: `partner_analysis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dimensions
  };
}

function chooseFarDimensions(userAnalysis, primaryEmotion) {
  const stress = Number(userAnalysis.dimensions?.stress || 50);
  const energy = Number(userAnalysis.dimensions?.energy || 50);
  const clarity = Number(userAnalysis.dimensions?.clarity || 50);
  if (stress > 68) return ["calm", "energy"];
  if (energy > 72 || primaryEmotion === "excited") return ["calm", "stress"];
  if (clarity < 42) return ["clarity", "energy"];
  return ["stress", "clarity"];
}

function buildPartnerStory(template, analysis) {
  const dims = analysis.dimensions || {};
  const highEnergy = Number(dims.energy || 50) > 68;
  const highStress = Number(dims.stress || 50) > 68;
  const lowCalm = Number(dims.calm || 50) < 36;
  const lowClarity = Number(dims.clarity || 50) < 38;
  if (template.primaryEmotion === "excited" || highEnergy) {
    return "我今天刚把一件拖了很久的事推进过去，整个人有点兴奋，但也怕这股劲过了会突然空下来。现在挺想找人接住这点分享欲。";
  }
  if (template.primaryEmotion === "lonely") {
    return "我最近搬到一个不太熟的地方，白天还好，晚上回去会觉得房间特别安静。不是多大的事，就是有点想和陌生人交换几句小事。";
  }
  if (highStress || lowCalm) {
    return "我这阵子被几个截止时间追着跑，白天还能处理事，晚上反而容易复盘到停不下来。最近常出去走一圈，让自己别一直绷着。";
  }
  if (lowClarity || template.primaryEmotion === "mixed") {
    return "我最近完成了一个阶段目标，本来应该轻松一点，但心里反而混着开心、疲惫和不确定。还没理清，所以想先随便说说。";
  }
  return template.selfIntro;
}

function findCandidate(user) {
  let best = null;
  let bestScore = -Infinity;
  for (const candidateId of waiting) {
    if (candidateId === user.id) continue;
    const candidate = users.get(candidateId);
    if (!candidate || candidate.roomId || candidate.role !== "human") continue;
    if (candidate.accountId && user.accountId && candidate.accountId === user.accountId) continue;
    const score = compatibility(user, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function compatibility(aUser, bUser) {
  const a = aUser.analysis;
  const b = bUser.analysis;
  const valenceGap = Math.abs(Number(a.valence || 0) - Number(b.valence || 0));
  const arousalGap = Math.abs(Number(a.arousal || 0.5) - Number(b.arousal || 0.5));
  const stressFit = 1 - Math.abs(Number(a.dimensions?.stress || 50) - (100 - Number(b.dimensions?.calm || 50))) / 100;
  const socialFit = 1 - Math.abs(Number(a.dimensions?.social || 50) - Number(b.dimensions?.social || 50)) / 100;
  const styleBonus = a.matchStyle === b.matchStyle ? 0.18 : 0;
  const complementBonus = Number(a.valence || 0) < -0.25 && Number(b.valence || 0) > -0.05 ? 0.22 : 0;
  return 1.05 - valenceGap * 0.32 - arousalGap * 0.22 + stressFit * 0.22 + socialFit * 0.18 + styleBonus + complementBonus;
}

function createRoom(a, b) {
  ensureDistinctAliases(a, b);
  const room = {
    id: `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    participantIds: [a.id, b.id],
    createdAt: Date.now(),
    status: "open",
    partnerStatus: "online",
    replyCount: 0,
    lastActivityAt: Date.now(),
    matchBasis: buildMatchBasis(a, b),
    messages: [],
    pendingReply: false,
    typingParticipantId: null
  };
  a.roomId = room.id;
  b.roomId = room.id;
  rooms.set(room.id, room);
  saveRoom({
    id: room.id,
    accountId: a.accountId,
    partner: publicUser(b),
    matchBasis: room.matchBasis,
    status: room.status
  });
  if (b.role === "human" && b.accountId && b.accountId !== a.accountId) {
    saveRoom({
      id: room.id,
      accountId: b.accountId,
      partner: publicUser(a),
      matchBasis: room.matchBasis,
      status: room.status
    });
  }
  return room;
}

function buildMatchBasis(aUser, bUser) {
  const a = aUser.analysis;
  const b = bUser.analysis;
  const mode = a.primaryEmotion === b.primaryEmotion ? "情绪相近" : "节奏互补";
  return {
    mode,
    reason: buildMatchReason(a, b),
    sharedFrequency: sharedFrequency(a, b, aUser.signalStrength),
    signalStrength: aUser.signalStrength || 35,
    safetyBoundary: safetyBoundary(a),
    contrastDimensions: contrastDimensions(a, b),
    signals: [a.primaryEmotion, b.primaryEmotion, a.matchStyle, b.matchStyle].filter(Boolean),
    topicSuggestions: buildTopics(a, b, bUser)
  };
}

function buildMatchReason(a, b) {
  const hints = Array.isArray(a.matchHints) ? a.matchHints.slice(0, 1).join("；") : "";
  const shared = a.keywords?.[0] || a.label || "此刻感受";
  const partner = b.keywords?.[0] || b.label || "对方状态";
  return hints || "你们都在「" + shared + "」和「" + partner + "」附近，但节奏不完全一样。";
}

function sharedFrequency(a, b, strength = 35) {
  const social = 100 - Math.abs(Number(a.dimensions?.social || 50) - Number(b.dimensions?.social || 50));
  const openness = 100 - Math.abs(Number(a.dimensions?.openness || 50) - Number(b.dimensions?.openness || 50));
  const pressure = 100 - Math.abs(Number(a.dimensions?.stress || 50) - Number(b.dimensions?.stress || 50));
  return Math.max(18, Math.min(96, Math.round((social + openness + pressure + Number(strength || 35)) / 4)));
}

function safetyBoundary(analysis) {
  if (analysis.safetyFlag === "self_harm") return "如果这段心情已经伤到自己，请先离开聊天并联系身边可信的人或当地紧急支持。";
  if (Number(analysis.dimensions?.openness || 50) < 42) return "只聊愿意公开的部分，不追问隐私；任何时候都可以离开。";
  return "保持匿名距离，不索要隐私；感到不适可立即离开或举报。";
}

function contrastDimensions(a, b) {
  return dimensionKeys
    .map((key) => ({
      key,
      gap: Math.abs(Number(a.dimensions?.[key] || 50) - Number(b.dimensions?.[key] || 50))
    }))
    .sort((x, y) => y.gap - x.gap)
    .slice(0, 2);
}

function buildTopics(a, b, partner) {
  const topics = [];
  const first = a.keywords?.[0] || a.label || "今晚这件事";
  topics.push("先聊聊「" + first + "」最明显的那一下");
  topics.push("问问 " + partner.alias + " 刚才为什么停在这里");
  if (Number(a.dimensions?.social || 50) > 65) topics.push("分享一个今天想被回应的小细节");
  if (Number(a.dimensions?.clarity || 50) < 45) topics.push("只说一个还没理清的感受");
  return [...new Set(topics)].slice(0, 3);
}

function firstCompanionLine(companion, analysis) {
  if (Number(analysis.dimensions?.stress || 50) > 65) {
    return "嗨，我在。今晚有点安静。";
  }
  if (Number(analysis.dimensions?.social || 50) > 65) {
    return "嗨，我刚收拾完桌子。";
  }
  return "你好呀。";
}

function scheduleCompanionReply(room, companion, human, body) {
  if (room.pendingReply || room.status === "left") return;
  room.pendingReply = true;
  room.typingParticipantId = companion.id;
  const delayMs = 1800 + Math.min(3600, String(body).length * 42) + Math.floor(Math.random() * 1800);
  setTimeout(async () => {
    try {
      if (room.status === "left") return;
      const history = room.messages.slice(-10).map((message) => ({
        mine: message.senderId === human.id,
        senderAlias: message.senderAlias,
        text: message.text
      }));
      const reply = await generateCompanionReply({ companion, userAnalysis: human.analysis, message: body, history, replyCount: room.replyCount });
      const cleanReply = cleanCompanionReply(String(reply || ""), room, companion, body);
      if (cleanReply) pushMessage(room, companion, cleanReply);
    } catch {
      const fallback = localReply(companion, body, room);
      if (fallback) pushMessage(room, companion, fallback);
    } finally {
      room.pendingReply = false;
      room.typingParticipantId = null;
    }
  }, delayMs);
}

function cleanCompanionReply(reply, room, companion, currentUserText = "") {
  const withoutAlias = reply
    .replace(new RegExp(`^${escapeRegExp(companion.alias)}[：:，,\\s]*`), "")
    .replace(/^(作为|我是).{0,12}(助手|模型|系统).*/i, "")
    .replace(/^(总结一下|我理解你|听起来你).{0,8}[：:，,]/, "")
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .trim();
  const compact = withoutAlias
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  const shaped = shapeHumanReply(compact, currentUserText);
  if (!shaped || isBannedReply(shaped) || isRepeated(room, companion, shaped) || looksBroken(shaped)) {
    return localReply(companion, currentUserText || room.messages.at(-1)?.text || "", room);
  }
  return ensureEnding(shaped);
}

function localReply(companion, body, room) {
  const text = String(body || "");
  const replyCount = room.replyCount || 0;
  const options = [];
  if (/^你?好[呀啊]?$|hello|hi/i.test(text)) {
    options.push("嗨。");
    options.push("嗯，在。");
    options.push("你好呀。");
  }
  if (/刚刚|刚才|做了什么|在干嘛|干什么/.test(text)) {
    options.push("刚洗完澡，头发还没吹干。你呢？");
    options.push("刚刷了会儿视频，有点困。");
    options.push("在收拾桌子，没干什么大事。");
  }
  if (/真人|真的是人|不是机器人/.test(text)) {
    options.push("你就当我是今晚在这边的人吧。");
    options.push("我不会要你隐私，聊这一会儿就好。");
  }
  if (/微信|联系方式|加个|vx|QQ/i.test(text)) {
    options.push("不了，我们就在这里聊一会儿吧。");
    options.push("先不交换联系方式，安全一点。");
  }
  if (/烦|憋火|生气|火大|堵/.test(text)) {
    options.push("要不要先骂两句。");
    options.push("是被什么事卡住了吗？");
    options.push("嗯，今天挺堵的。");
  }
  if (/焦虑|紧绷|压力|撑着|停不下来|抽空|没电|累|疲惫|肩膀|放下来/.test(text)) {
    options.push("那先别硬撑了。");
    options.push("我刚也有点困，脑子慢半拍。");
    options.push("你先倒出来一点就行。");
  }
  if (/开心|兴奋|好事|完成|终于(过了|完成|做完|推进|结束)/.test(text)) {
    options.push("这事可以小小庆祝一下。");
    options.push("听着还挺爽的。");
    options.push("那你现在是不是有点睡不着？");
  }
  if (/你.*(会不会|有没有)/.test(text)) {
    options.push("会，我有时会先发会儿呆。");
    options.push("会，偶尔也想从人堆里退出来。");
  }
  if (/你.*怎么.*(熬|面对|过)|你会怎么|怎么面对/.test(text)) {
    options.push("我一般先拖一会儿，再慢慢动。");
    options.push("我会先把最小那步做了。");
  }
  if (/孤独|空|没人|房间|晚上/.test(text)) {
    options.push("我刚也在发呆，屋里挺安静。");
    options.push("这种时候确实会空一下。");
    options.push("那就先聊点小事吧。");
  }
  if (/不用问太深|小事|真实的小事/.test(text)) {
    options.push("行，我刚刷了会儿视频。");
    options.push("我刚把桌子收了一下。");
  }
  if (/陪我|不用一直问|待会儿|安静/.test(text)) {
    options.push("好，我不追问。");
    options.push("可以，就待一会儿。");
  }
  if (/一小会|只聊|聊一会|待一会|马上走|稍后/.test(text)) {
    options.push("可以，就聊一小会儿。");
    options.push("嗯，不用聊太重。");
  }
  if (/确认|有人在|在吗|还在/.test(text)) {
    options.push("在。");
    options.push("嗯，我还在。");
  }
  if (/谢谢|稳一点|好多了|比刚才|好一些|舒服一点/.test(text)) {
    options.push("那就好，先这样也行。");
    options.push("不客气，我也刚好没睡。");
  }
  if (/[？?]$|怎么|咋/.test(text)) {
    options.push("刚倒了杯水，没干什么大事。");
    options.push("我可能会先发会儿呆。");
  }
  options.push("嗯，你先说。");
  options.push("我听着。");
  const used = new Set(room.messages.filter((message) => message.senderId === companion.id).map((message) => message.text));
  const next = chooseFreshReply(options, used, room, companion, text, replyCount);
  return ensureEnding(shapeHumanReply(next, text));
}

function chooseFreshReply(options, used, room, companion, text, replyCount) {
  const fresh = options.find((option) => !used.has(option) && !isRepeated(room, companion, option));
  if (fresh) return fresh;
  const safetyPool = [
    "嗯，你先说。",
    "我听着。",
    "刚倒了杯水，正好在。",
    "可以，不用讲太满。",
    "那先停在这儿也行。"
  ];
  return safetyPool.find((option) => !used.has(option) && !isRepeated(room, companion, option)) || safetyPool[(replyCount + text.length) % safetyPool.length];
}

function shapeHumanReply(reply, currentUserText = "") {
  let value = String(reply || "")
    .replace(/\s+/g, " ")
    .replace(/^(好的|嗯嗯)[，,]/, "")
    .trim();
  if (!value) return "";
  if (isBannedReply(value)) return "";
  const userShort = normalizeReply(currentUserText).length <= 3;
  const parts = value
    .split(/(?<=[。！？!?…])\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, userShort ? 1 : 2);
  value = parts.join("");
  if (countCjk(value) > 60) {
    value = truncateAtSentence(value, 60);
  }
  if (userShort && countCjk(value) > 16) {
    value = truncateAtSentence(value, 16);
  }
  return value.trim();
}

function truncateAtSentence(value, maxCjk) {
  let count = 0;
  let output = "";
  for (const char of String(value)) {
    if (/[\u4e00-\u9fff]/.test(char)) count += 1;
    if (count > maxCjk) break;
    output += char;
  }
  const sentence = output.match(/^.*?[。！？!?…]/)?.[0];
  return (sentence && countCjk(sentence) >= 2 ? sentence : output).replace(/[，,、；;：:]$/, "");
}

function countCjk(value) {
  return (String(value).match(/[\u4e00-\u9fff]/g) || []).length;
}

function isBannedReply(reply) {
  return /(我理解你|我们可以慢一点|我看到了|看到你.*(来了|说|段)|这句.*真实|这句话.*真实|作为一个|我是\s*AI|我是.*模型|模型|系统|深呼吸|尝试|心理|咨询|陪着你|我会陪着你)/i.test(String(reply || ""));
}

function isRepeated(room, companion, reply) {
  const normalized = normalizeReply(reply);
  return room.messages
    .filter((message) => message.senderId === companion.id)
    .some((message) => similarity(normalizeReply(message.text), normalized) > 0.78);
}

function looksBroken(reply) {
  if (reply.length < 2) return true;
  if (isBannedReply(reply)) return true;
  if (/[。！？!?，,]$/.test(reply)) return false;
  if (reply.length < 12) return false;
  return /我刚|我也|那种|所以|但是|因为|时候|感觉$/.test(reply);
}

function ensureEnding(reply) {
  const value = String(reply || "").trim();
  if (!value) return value;
  return /[。！？!?…]$/.test(value) ? value : `${value}。`;
}

function normalizeReply(value) {
  return String(value).replace(/\s+/g, "").replace(/[，。！？!?、,.]/g, "");
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  let same = 0;
  for (const char of new Set(short)) {
    if (long.includes(char)) same += 1;
  }
  return same / Math.max(1, new Set(long).size);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pushMessage(room, sender, body) {
  const message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    roomId: room.id,
    senderId: sender.id,
    senderAlias: sender.alias,
    text: body.slice(0, 800),
    createdAt: Date.now()
  };
  room.messages.push(message);
  room.lastActivityAt = message.createdAt;
  if (sender.role !== "human") room.replyCount = (room.replyCount || 0) + 1;
  saveMessage({
    id: message.id,
    roomId: room.id,
    senderId: sender.id,
    senderType: sender.role === "ai-companion" ? "partner" : "human",
    senderAlias: sender.alias,
    text: message.text,
    createdAt: message.createdAt
  });
  return message;
}

function addSystemMessage(room, sender, body) {
  pushMessage(room, sender, body);
}

function removeWaiting(userId) {
  const index = waiting.indexOf(userId);
  if (index >= 0) waiting.splice(index, 1);
}

function addWaiting(user) {
  if (!user.waitingSince) user.waitingSince = Date.now();
  if (!waiting.includes(user.id)) waiting.push(user.id);
}

function removeStaleWaiting(exceptUserId = "") {
  const now = Date.now();
  for (let index = waiting.length - 1; index >= 0; index -= 1) {
    const user = users.get(waiting[index]);
    if (!user || user.roomId || (user.id !== exceptUserId && user.waitingSince && now - user.waitingSince > WAIT_WINDOW_MS * 2)) {
      waiting.splice(index, 1);
    }
  }
}

function buildIdentity(analysis) {
  const key = String(analysis.primaryEmotion || "mixed").toLowerCase();
  const options = moodNames[key] || moodNames.mixed;
  const aliasBase = options[Math.abs(hashText(analysis.inputHash || analysis.label)) % options.length];
  return {
    alias: themedAlias(aliasBase, analysis),
    avatar: aliasBase.slice(0, 1),
    avatarTone: avatarTone(analysis)
  };
}

function ensureDistinctAliases(a, b) {
  const aBase = stripAliasSuffix(a.alias);
  const bBase = stripAliasSuffix(b.alias);
  if (a.alias !== b.alias && aBase !== bBase) return;
  const alternates = ["听澜小舟", "南栀月台", "旧雨蓝岸", "青芒星火", "半夏静港", "远青灯塔", "溪白晚风"];
  const next = alternates.find((alias) => alias !== aBase && alias !== bBase) || "远青";
  b.alias = themedAlias(next, b.analysis || {});
  b.avatar = next.slice(0, 1);
}

function stripAliasSuffix(alias = "") {
  return String(alias).replace(/-(\d{2,3})$/, "").replace(/[·・](朝阳|小焰|亮潮|雨声|低蓝|旧灯|雾灯|慢频|定锚|月白|慢舟|静港|赤潮|暗火|止泊|远灯|星港|来信|星雾|微光|停靠|晚风|浅湾|白茶)$/, "");
}

function themedAlias(base, analysis = {}) {
  const cleanBase = stripAliasSuffix(base || "远灯来客").slice(0, 8);
  const key = String(analysis.emotionTheme?.key || analysis.primaryEmotion || "mixed").toLowerCase();
  const suffixes = {
    excited: ["朝阳", "小焰", "亮潮"],
    sad: ["雨声", "低蓝", "旧灯"],
    anxious: ["雾灯", "慢频", "定锚"],
    tired: ["月白", "慢舟", "静港"],
    angry: ["赤潮", "暗火", "止泊"],
    lonely: ["远灯", "星港", "来信"],
    mixed: ["星雾", "微光", "停靠"],
    calm: ["晚风", "浅湾", "白茶"]
  };
  const pool = suffixes[key] || suffixes.mixed;
  const suffix = pool[Math.abs(hashText(`${cleanBase}:${analysis.inputHash || analysis.label || key}`)) % pool.length];
  return cleanBase.includes(suffix) ? cleanBase : `${cleanBase}·${suffix}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function avatarTone(analysis) {
  const stress = Number(analysis.dimensions?.stress || 50);
  const energy = Number(analysis.dimensions?.energy || 50);
  const social = Number(analysis.dimensions?.social || 50);
  if (stress > 68) return "mist";
  if (energy > 70) return "spark";
  if (social > 68) return "warm";
  return "sage";
}

function hashText(text) {
  const value = String(text || "");
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function publicUser(user) {
  return {
    id: user.id,
    alias: user.alias,
    avatar: user.avatar,
    avatarTone: user.avatarTone,
    role: user.role === "human" ? "human" : "person",
    selfIntro: user.selfIntro,
    profile: publicProfile(user.profile),
    analysis: user.analysis,
    accountId: user.accountId,
    entryId: user.entryId,
    signalStrength: user.signalStrength,
    roomId: user.roomId
  };
}

function publicSelfIntro(profile = {}) {
  if (profile?.publicFields?.selfIntro === false) return "";
  return String(profile?.selfIntro || "").trim();
}

function publicProfile(profile = {}) {
  const publicFields = profile.publicFields || {};
  return {
    mbti: publicFields.mbti ? String(profile.mbti || "") : "",
    zodiac: publicFields.zodiac ? String(profile.zodiac || "") : "",
    selfIntro: publicFields.selfIntro === false ? "" : String(profile.selfIntro || ""),
    boundary: publicFields.boundary === false ? "" : String(profile.boundary || "")
  };
}

function publicRoom(room, viewerId) {
  const partnerId = room.participantIds.find((id) => id !== viewerId);
  return {
    id: room.id,
    viewerId,
    partner: publicUser(users.get(partnerId)),
    participantIds: [...room.participantIds],
    status: room.status,
    partnerStatus: room.partnerStatus,
    lastActivityAt: room.lastActivityAt,
    matchBasis: room.matchBasis,
    createdAt: room.createdAt
  };
}
