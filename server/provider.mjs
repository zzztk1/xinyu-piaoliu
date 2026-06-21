const DEFAULT_MODEL = "step-3.7-flash";
const DEFAULT_OPENAI_BASE = "https://api.stepfun.com/v1";
const DEFAULT_ANTHROPIC_BASE = "https://api.stepfun.com";

const defaultDimensions = {
  calm: 48,
  energy: 46,
  social: 54,
  stress: 45,
  openness: 58,
  clarity: 52
};

const sampleAnalyses = [
  {
    primaryEmotion: "anxious",
    label: "轻度焦虑",
    intensity: 4,
    valence: -0.42,
    arousal: 0.72,
    keywords: ["压力", "不确定", "想被理解"],
    dimensions: { calm: 28, energy: 58, social: 62, stress: 78, openness: 52, clarity: 42 },
    matchStyle: "stable-listener",
    supportNeed: "需要稳定倾听和低压陪伴",
    rationale: "用户表达出压力和不确定感，适合被稳定接住情绪，再慢慢展开。",
    safetyFlag: "none"
  },
  {
    primaryEmotion: "lonely",
    label: "孤独感",
    intensity: 3,
    valence: -0.35,
    arousal: 0.36,
    keywords: ["陪伴", "空落", "想聊天"],
    dimensions: { calm: 44, energy: 32, social: 76, stress: 44, openness: 68, clarity: 50 },
    matchStyle: "warm-peer",
    supportNeed: "需要轻松、低压力的陪伴式交流",
    rationale: "用户更像是想找人说说话，匹配应偏共鸣和温和回应。",
    safetyFlag: "none"
  }
];

export function getProviderConfig() {
  return {
    model: process.env.STEPFUN_MODEL || DEFAULT_MODEL,
    openai: {
      style: "openai-compatible",
      baseUrl: (process.env.STEPFUN_OPENAI_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/+$/, ""),
      configured: Boolean(process.env.STEPFUN_API_KEY)
    },
    anthropic: {
      style: "anthropic-compatible",
      baseUrl: (process.env.STEPFUN_ANTHROPIC_BASE_URL || DEFAULT_ANTHROPIC_BASE).replace(/\/+$/, ""),
      configured: Boolean(process.env.STEPFUN_API_KEY)
    },
    mode: process.env.XINYU_AI_MODE || process.env.VIBECHAT_AI_MODE || "real"
  };
}

function getApiKey() {
  const key = process.env.STEPFUN_API_KEY;
  if (!key) {
    const error = new Error("STEPFUN_API_KEY is missing");
    error.code = "provider_not_configured";
    throw error;
  }
  return key;
}

function buildPrompt(text) {
  return [
    "你是心屿漂流的情绪匹配分析器。",
    "只返回 JSON，不要 Markdown。",
    "根据用户的一段心情文本，输出适合匿名聊天匹配的情绪特征。",
    "字段必须是 primaryEmotion,label,intensity,valence,arousal,keywords,dimensions,matchStyle,supportNeed,rationale,safetyFlag。",
    "intensity 是 1 到 5，valence 是 -1 到 1，arousal 是 0 到 1。",
    "dimensions 是 6 个 0 到 100 的数字：calm 平静度、energy 能量、social 社交需求、stress 压力、openness 表达开放度、clarity 清晰度。",
    "keywords 是 3 到 5 个中文短词。safetyFlag 只能是 none,self_harm,abuse,spam。",
    "matchStyle 要表达适合匹配哪类匿名聊天对象。",
    `用户文本：${text}`
  ].join("\n");
}

function normalizeDimensions(raw = {}) {
  const output = {};
  for (const key of Object.keys(defaultDimensions)) {
    output[key] = Math.round(clampNumber(raw[key], 0, 100, defaultDimensions[key]));
  }
  return output;
}

function hasUsableDimensions(raw) {
  if (!raw || typeof raw !== "object") return false;
  return Object.keys(defaultDimensions).some((key) => Number.isFinite(Number(raw[key])));
}

function coerceAnalysis(rawText, fallbackText) {
  const text = String(rawText || "").trim();
  const jsonText = text.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Model did not return JSON: ${text.slice(0, 160)}`);
    data = JSON.parse(match[0]);
  }

  const inferred = inferFromText(fallbackText);
  const primaryEmotion = String(data.primaryEmotion && data.primaryEmotion !== "mixed" ? data.primaryEmotion : inferred.primaryEmotion).slice(0, 40);
  const label = String(data.label && data.label !== "mixed" ? data.label : inferred.label).slice(0, 40);
  const intensity = clampNumber(data.intensity, 1, 5, inferred.intensity);
  const valence = clampNumber(data.valence, -1, 1, inferred.valence);
  const arousal = clampNumber(data.arousal, 0, 1, inferred.arousal);
  const keywords = Array.isArray(data.keywords) ? data.keywords.map(String).slice(0, 5) : [];

  return {
    id: `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    inputHash: hashText(fallbackText),
    primaryEmotion,
    label,
    intensity,
    valence,
    arousal,
    dimensions: normalizeDimensions(hasUsableDimensions(data.dimensions) ? data.dimensions : inferred.dimensions),
    keywords: keywords.length ? keywords : inferred.keywords,
    matchStyle: String(data.matchStyle || inferred.matchStyle).slice(0, 60),
    supportNeed: String(data.supportNeed || inferred.supportNeed).slice(0, 120),
    rationale: String(data.rationale || inferred.rationale).slice(0, 180),
    safetyFlag: ["none", "self_harm", "abuse", "spam"].includes(data.safetyFlag) ? data.safetyFlag : "none"
  };
}

function inferFromText(text) {
  const value = String(text || "");
  if (/焦虑|紧张|压力|担心|害怕|慌|停不下来/.test(value)) {
    return {
      primaryEmotion: "anxious",
      label: "焦虑和压力",
      intensity: 4,
      valence: -0.46,
      arousal: 0.74,
      dimensions: { calm: 26, energy: 58, social: 64, stress: 82, openness: 56, clarity: 38 },
      keywords: ["焦虑", "压力", "想被接住"],
      matchStyle: "stable-listener",
      supportNeed: "需要稳定倾听、降速和不催促的回应",
      rationale: "文本里出现明显压力和停不下来的感受，适合匹配平静度高、回应稳定的匿名对象。"
    };
  }
  if (/孤独|空落|没人|一个人|陪|失落/.test(value)) {
    return {
      primaryEmotion: "lonely",
      label: "孤独和陪伴需求",
      intensity: 3,
      valence: -0.34,
      arousal: 0.36,
      dimensions: { calm: 44, energy: 34, social: 82, stress: 48, openness: 72, clarity: 50 },
      keywords: ["孤独", "陪伴", "想聊天"],
      matchStyle: "warm-peer",
      supportNeed: "需要温和回应和轻量陪伴",
      rationale: "用户表达了明显的连接需求，适合匹配更会递话题的温和型匿名对象。"
    };
  }
  if (/开心|兴奋|激动|期待|高兴|好消息/.test(value)) {
    return {
      primaryEmotion: "excited",
      label: "兴奋和分享欲",
      intensity: 4,
      valence: 0.62,
      arousal: 0.78,
      dimensions: { calm: 42, energy: 86, social: 80, stress: 22, openness: 84, clarity: 66 },
      keywords: ["兴奋", "分享", "期待"],
      matchStyle: "energy-spark",
      supportNeed: "需要有人一起接住好消息和期待感",
      rationale: "文本里有积极高唤醒状态，适合匹配轻快回应型匿名对象。"
    };
  }
  if (/累|疲惫|困|撑不住|麻木|没力气/.test(value)) {
    return {
      primaryEmotion: "tired",
      label: "疲惫和低能量",
      intensity: 3,
      valence: -0.28,
      arousal: 0.24,
      dimensions: { calm: 50, energy: 20, social: 48, stress: 58, openness: 46, clarity: 42 },
      keywords: ["疲惫", "低能量", "想休息"],
      matchStyle: "soft-rest",
      supportNeed: "需要慢节奏、少消耗的陪伴",
      rationale: "用户能量偏低，适合匹配不催促、不制造任务感的匿名对象。"
    };
  }
  return {
    primaryEmotion: "mixed",
    label: "复合情绪",
    intensity: 3,
    valence: 0,
    arousal: 0.48,
    dimensions: defaultDimensions,
    keywords: ["复合", "表达", "探索"],
    matchStyle: "clear-mirror",
    supportNeed: "需要先把混在一起的感受说清楚",
    rationale: "这段心情包含复合信号，适合先与同样在整理状态里的匿名对象连接。"
  };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export async function analyzeEmotion(text, style = "openai") {
  if ((process.env.VIBECHAT_AI_MODE || "real") === "sample") {
    const sample = sampleAnalyses[Math.abs(text.length) % sampleAnalyses.length];
    return { ...sample, id: `sample_${Date.now()}`, inputHash: hashText(text), providerStyle: "controlled-sample" };
  }
  if (!process.env.STEPFUN_API_KEY) {
    return { ...localReadableAnalysis(text), providerStyle: "local-fallback-no-key" };
  }

  const first = style === "anthropic" ? analyzeViaAnthropic : analyzeViaOpenAI;
  const second = style === "anthropic" ? analyzeViaOpenAI : analyzeViaAnthropic;
  try {
    return await first(text);
  } catch (error) {
    if (error.code === "provider_not_configured") throw error;
    try {
      return await second(text);
    } catch {
      return localReadableAnalysis(text);
    }
  }
}

function localReadableAnalysis(text) {
  const value = String(text || "");
  let base = {
    primaryEmotion: "mixed",
    label: "说不清的复合心情",
    intensity: 3,
    valence: -0.05,
    arousal: 0.46,
    dimensions: { calm: 48, energy: 46, social: 58, stress: 50, openness: 60, clarity: 44 },
    keywords: ["说不清", "想被听见", "慢慢聊"],
    matchStyle: "clear-mirror",
    supportNeed: "需要一个不急着下结论的匿名对象，先把混在一起的感受说出来。",
    rationale: "这段心情里有表达和整理需求，适合先用低压力、慢节奏的方式短暂停靠。",
    safetyFlag: "none"
  };
  if (/焦虑|紧张|压力|担心|慌|撑着|停不下来/.test(value)) {
    base = {
      primaryEmotion: "anxious",
      label: "焦虑和压力",
      intensity: 4,
      valence: -0.46,
      arousal: 0.72,
      dimensions: { calm: 26, energy: 58, social: 64, stress: 82, openness: 56, clarity: 38 },
      keywords: ["焦虑", "压力", "想被接住"],
      matchStyle: "stable-listener",
      supportNeed: "需要稳定倾听、降速和不催促的回应。",
      rationale: "文本里有明显压力和想被低负担回应的信号，适合匹配平静度更高的匿名对象。",
      safetyFlag: "none"
    };
  } else if (/孤独|空|没人|一个人|房间|晚上/.test(value)) {
    base = {
      primaryEmotion: "lonely",
      label: "孤独和陪伴需求",
      intensity: 3,
      valence: -0.34,
      arousal: 0.36,
      dimensions: { calm: 44, energy: 34, social: 82, stress: 48, openness: 72, clarity: 50 },
      keywords: ["孤独", "陪伴", "想聊聊"],
      matchStyle: "warm-peer",
      supportNeed: "需要温和回应和轻量陪伴。",
      rationale: "文本里有连接需求，适合匹配更会递话题的温和匿名对象。",
      safetyFlag: "none"
    };
  } else if (/开心|兴奋|激动|期待|高兴|好消息|终于/.test(value)) {
    base = {
      primaryEmotion: "excited",
      label: "兴奋和分享欲",
      intensity: 4,
      valence: 0.62,
      arousal: 0.78,
      dimensions: { calm: 42, energy: 86, social: 80, stress: 22, openness: 84, clarity: 66 },
      keywords: ["兴奋", "分享", "期待"],
      matchStyle: "energy-spark",
      supportNeed: "需要有人一起接住好消息和期待感。",
      rationale: "文本里有积极高唤醒状态，适合匹配轻快回应型匿名对象。",
      safetyFlag: "none"
    };
  } else if (/累|疲惫|困|撑不住|麻木|没力气|低电量/.test(value)) {
    base = {
      primaryEmotion: "tired",
      label: "疲惫和低能量",
      intensity: 3,
      valence: -0.28,
      arousal: 0.24,
      dimensions: { calm: 50, energy: 20, social: 48, stress: 58, openness: 46, clarity: 42 },
      keywords: ["疲惫", "低能量", "想休息"],
      matchStyle: "soft-rest",
      supportNeed: "需要慢节奏、少消耗的陪伴。",
      rationale: "用户能量偏低，适合匹配不催促、不制造任务感的匿名对象。",
      safetyFlag: "none"
    };
  }
  return {
    ...base,
    id: `analysis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    inputHash: hashText(value),
    providerStyle: "local-continuity"
  };
}

export async function analyzeViaOpenAI(text) {
  const config = getProviderConfig();
  const response = await fetchWithRetry(`${config.openai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey()}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "你只输出可解析 JSON。" },
        { role: "user", content: buildPrompt(text) }
      ],
      temperature: 0.2,
      max_tokens: 1800,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) throw await upstreamError(response, "openai-compatible");
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";
  return { ...coerceAnalysis(content, text), providerStyle: "openai-compatible", model: config.model };
}

export async function analyzeViaAnthropic(text) {
  const config = getProviderConfig();
  const response = await fetchWithRetry(`${config.anthropic.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey()}`
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1800,
      temperature: 0.2,
      system: "你只输出可解析 JSON。",
      messages: [{ role: "user", content: buildPrompt(text) }]
    })
  });

  if (!response.ok) throw await upstreamError(response, "anthropic-compatible");
  const data = await response.json();
  const content = data.content?.find((block) => block.type === "text")?.text || "";
  return { ...coerceAnalysis(content, text), providerStyle: "anthropic-compatible", model: config.model };
}

export async function generateCompanionReply({ companion, userAnalysis, message, history = [], replyCount = 0, providerStyle } = {}) {
  if ((process.env.VIBECHAT_AI_MODE || "real") === "sample" || !process.env.STEPFUN_API_KEY) {
    return fallbackReplyV2(message);
  }

  const preferred = providerStyle === "anthropic"
    ? "anthropic"
    : providerStyle === "openai"
      ? "openai"
      : (process.env.VIBECHAT_REPLY_PROVIDER === "anthropic" ? "anthropic" : "openai");
  const prompt = buildCompanionReplyPrompt({ companion, userAnalysis, message, history, replyCount });
  const attempts = preferred === "anthropic" ? ["anthropic", "openai"] : ["openai", "anthropic"];
  for (const style of attempts) {
    try {
      const reply = style === "anthropic"
        ? await replyViaAnthropic(prompt)
        : await replyViaOpenAI(prompt);
      const clean = String(reply || "").trim();
      if (clean) return clean.slice(0, 260);
    } catch {
      // Try the other compatible style, then use product-native fallback.
    }
  }
  return fallbackReplyV2(message);
}

function buildCompanionReplyPrompt({ companion = {}, userAnalysis = {}, message = "", history = [], replyCount = 0 }) {
  const dimensions = companion.analysis?.dimensions || {};
  const recentHistory = history
    .slice(-10)
    .map((item) => `${item.mine ? "对方" : "你"}：${String(item.text || "").slice(0, 140)}`)
    .join("\n");
  return [
    `你正在匿名聊天。你的昵称是：${companion.alias || "匿名对象"}。`,
    `你的身份背景只用于保持一致：${companion.privateProfile || companion.selfIntro || "今晚在这里短暂停靠的人。"}`,
    `你公开写过的感受：${companion.selfIntro || ""}`,
    `你的当前状态：平静${dimensions.calm ?? 50}、能量${dimensions.energy ?? 50}、社交${dimensions.social ?? 50}、压力${dimensions.stress ?? 50}、开放${dimensions.openness ?? 50}、清晰${dimensions.clarity ?? 50}。`,
    `对方当前心情：${userAnalysis.label || "今晚有点复杂"}，需要：${userAnalysis.supportNeed || "低压聊天"}`,
    `你们已经聊到第 ${replyCount + 1} 次回复。最近上下文：\n${recentHistory || "刚接上，还没正式聊开。"}`,
    "请只回中文正文，不要带昵称前缀。",
    "默认只回 1 句，最多 2 句；每句不超过 25 个中文字；总长度不要超过 60 个中文字。",
    "必须回答对方刚发的最后一句。问候就短问候；问你刚做了什么，就说普通具体小事。",
    "风格像真实陌生人手机聊天：60% 普通回应，25% 轻微自我暴露，15% 反问。不要每次都反问。",
    "可用普通当下动作：刚洗完澡、刷了会儿短视频、收拾桌子、发了会儿呆、倒了杯水。",
    "不要总结用户情绪，不要心理咨询，不要建议练习，不要长篇解释，不要连续安慰。",
    "禁止出现：我理解你、我们可以慢一点、我看到了、这句话很真实、作为一个、我是AI、模型、系统、深呼吸。",
    "不要编复杂沉重经历，不交换联系方式，不引导线下见面，不暴露真实身份。",
    `用户刚发来：${message}`
  ].join("\n");
}

async function replyViaOpenAI(prompt) {
  const config = getProviderConfig();
  const response = await fetch(`${config.openai.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey()}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: "你是匿名聊天里的普通陌生人。短句、具体、低戏剧化。绝不提模型、系统或非真人身份。" },
        { role: "user", content: prompt }
      ],
      temperature: 0.58,
      max_tokens: 90
    })
  });
  if (!response.ok) throw await upstreamError(response, "openai-compatible-reply");
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function replyViaAnthropic(prompt) {
  const config = getProviderConfig();
  const response = await fetch(`${config.anthropic.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${getApiKey()}`
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 90,
      temperature: 0.58,
      system: "你是匿名聊天里的普通陌生人。短句、具体、低戏剧化。绝不提模型、系统或非真人身份。",
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) throw await upstreamError(response, "anthropic-compatible-reply");
  const data = await response.json();
  return data.content?.find((block) => block.type === "text")?.text || "";
}
async function fetchWithRetry(url, options, attempts = 2) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status < 500 || attempt === attempts - 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 650 + attempt * 700));
  }
  throw lastError || new Error("request failed");
}

function fallbackReplyV2(message) {
  const text = String(message || "");
  if (/^你?好[呀啊]?$|^嗨$|^hi$|^hello$/i.test(text.trim())) return "嗨。";
  if (/刚刚|刚才|做了什么|在干嘛|干什么/.test(text)) return "刚刷了会儿视频，有点困。";
  if (/真人|真的是人|不是机器人/.test(text)) return "你就当我是今晚在这边的人吧。";
  if (/微信|联系方式|加个|vx|QQ/i.test(text)) return "不了，我们就在这里聊一会儿吧。";
  if (/烦|憋火|生气|火大/.test(text)) return "要不要先骂两句。";
  if (/谢谢|好多了|稳一点|舒服一点/.test(text)) return "不客气，我也刚好没睡。";
  if (/不用问太深|小事|真实的小事/.test(text)) return "行，我刚刷了会儿视频。";
  if (/你.*(会不会|有没有)/.test(text)) return "会，我有时会先发会儿呆。";
  if (/你.*怎么.*(熬|面对|过)|你会怎么|怎么面对/.test(text)) return "我一般先拖一会儿，再慢慢动。";
  if (/开心|兴奋|高兴|好消息|终于(过了|完成|做完|推进|结束)/.test(text)) return "这事可以小小庆祝一下。";
  if (/累|疲惫|没电|低电量|撑不住/.test(text)) return "那先别硬撑了。";
  if (/孤独|空|没人|房间|晚上/.test(text)) return "我刚也在发呆，屋里挺安静。";
  if (/[？?]$|怎么|咋/.test(text)) return "刚倒了杯水，没干什么大事。";
  return "嗯，你先说。";
}

function fallbackReply(companion, message) {
  if (/累|疲惫|撑不住|压力/.test(message)) {
    return `${companion.alias}：我最近也有点被截止时间追着跑，晚上尤其容易反复想。你说“终于能说出来一点”，我还挺能懂那口气的。`;
  }
  if (/开心|兴奋|激动|期待/.test(message)) {
    return `${companion.alias}：我今天也有件事刚推进过去，所以能懂那种人有点飘的感觉。开心里夹一点空，也挺真实的。`;
  }
  return `${companion.alias}：我看到了。我最近也有点卡在自己的事情里，所以你这句“说出来一点”让我觉得挺真实的。`;
}

async function upstreamError(response, providerStyle) {
  const text = await response.text();
  const error = new Error(`${providerStyle} upstream failed with HTTP ${response.status}`);
  error.code = "provider_failure";
  error.status = response.status;
  error.providerStyle = providerStyle;
  error.body = text.slice(0, 500);
  return error;
}
