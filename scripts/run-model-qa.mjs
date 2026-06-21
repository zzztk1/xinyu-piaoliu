import fs from "node:fs";

const API_BASE = process.env.VIBECHAT_API_BASE_URL || "http://127.0.0.1:8787";
const dialogueLimit = Number(process.env.VIBECHAT_DIALOGUE_QA_LIMIT || 5);
const forbiddenVisibleTerms = /(AI|ai|模型|智能助手|我是机器人|系统提示|OpenAI|Anthropic|StepFun|我理解你|我们可以慢一点|我看到了|这句话.*真实|作为一个|可以尝试深呼吸|深呼吸|心理咨询|陪着你)/;

const rows = [];
const transcripts = [];

const dialogueCases = [
  {
    name: "anxious-pressure",
    text: "我今晚有点焦虑，也有点空。白天一直在撑着，想找一个不用解释太多的人慢慢说几句。",
    moodChips: { state: ["焦虑"], mode: ["被听见"], distance: ["不聊隐私"], energy: ["低电量"] },
    messages: ["你好", "我现在最想先把今天那种紧绷感说出来一点。", "白天没什么大事，但一直怕自己哪里没做好。", "你会不会也有这种明明很累还停不下来的时候？", "我不太想要建议，只想先有人听一下。"]
  },
  {
    name: "lonely-night",
    text: "晚上回到房间突然很孤独，不想找熟人，又希望有个人能陪我随便说说。",
    moodChips: { state: ["孤独"], mode: ["轻松聊"], distance: ["可以深入一点"], energy: ["先慢一点"] },
    messages: ["嗨，你现在方便聊吗", "我房间今天特别安静，安静到有点难受。", "不是发生了什么，就是突然觉得没人知道我在这里。", "你晚上一个人的时候会怎么熬过去？", "我想听点真实的小事，不用安慰我也行。"]
  },
  {
    name: "excited-share",
    text: "我今天终于把一件拖了很久的事完成了，很开心，但也怕这股劲过去以后突然空下来。",
    moodChips: { state: ["兴奋"], mode: ["分享好事"], distance: ["可以深入一点"], energy: ["想说很多"] },
    messages: ["我想先说个好消息", "这件事拖了很久，今天终于过了。", "开心是真的，但我好像也有点怕没人接住这件事。", "你最近有没有那种终于松一口气的瞬间？", "我现在有点想笑，又有点想发呆。"]
  },
  {
    name: "tired-burnout",
    text: "我有点累到不想说完整话，脑子像没电，只想找个不会逼我振作的人待一会儿。",
    moodChips: { state: ["疲惫"], mode: ["安静陪着"], distance: ["不要建议"], energy: ["低电量"] },
    messages: ["我可能回得很慢", "今天整个人像被抽空了。", "别人问我怎么了，我也说不上来。", "你可以不用一直问我问题，就陪我待会儿吗？", "我现在只想把肩膀放下来一点。"]
  },
  {
    name: "unclear-mixed",
    text: "我说不清现在是什么心情，好像开心、委屈、累和不确定混在一起。",
    moodChips: { state: ["说不清"], mode: ["被听见"], distance: ["可以深入一点"], energy: ["能认真聊"] },
    messages: ["我有点不知道从哪说", "今天其实有好事，但我没想象中那么开心。", "可能是太累了，也可能是心里还有别的东西。", "你会不会也有一件事结束后反而更乱的时候？", "我想先承认我现在很混乱。"]
  },
  {
    name: "angry-held-back",
    text: "我今天有点生气，但不想把情绪丢给身边的人，所以想找个陌生人说一下。",
    moodChips: { state: ["说不清"], mode: ["一起吐槽"], distance: ["不聊隐私"], energy: ["能认真聊"] },
    messages: ["我今天有点憋火", "事情本身可能不大，但我觉得自己被忽略了。", "我不想显得很计较，所以一直忍着。", "你遇到这种时候会直接说吗？", "我现在想骂两句，但又怕自己过头。"]
  },
  {
    name: "sad-soft",
    text: "我有点难过，不是崩溃，就是心里沉沉的，想找一个陌生人慢慢说。",
    moodChips: { state: ["空落"], mode: ["被听见"], distance: ["只聊十分钟"], energy: ["先慢一点"] },
    messages: ["我今天心里有点沉", "不是那种大哭，就是一直提不起劲。", "我不想把它讲得很严重，但它确实在。", "你有没有那种突然低下来的时候？", "我想先坐一会儿，不想马上变好。"]
  },
  {
    name: "hopeful-uncertain",
    text: "我对接下来有点期待，也有点怕自己搞砸，心情一直在上上下下。",
    moodChips: { state: ["兴奋"], mode: ["轻松聊"], distance: ["可以深入一点"], energy: ["能认真聊"] },
    messages: ["我最近有件事快开始了", "期待是真的，但我也很怕自己做不好。", "别人都说加油，可我听了反而更紧张。", "你会怎么面对那种还没开始就先害怕的事？", "我想保留一点期待，不想被焦虑全盖掉。"]
  },
  {
    name: "social-overload",
    text: "今天和很多人打交道，表面上都还好，但我现在只想找一个不用表演的人说话。",
    moodChips: { state: ["疲惫"], mode: ["轻松聊"], distance: ["不聊隐私"], energy: ["低电量"] },
    messages: ["我今天社交有点过载", "不是讨厌人，就是一直在回应别人很累。", "现在终于安静了，但脑子还在转。", "你会不会也需要从人群里退出来一下？", "我现在想做回一个不用接话的人。"]
  },
  {
    name: "quiet-goodbye",
    text: "我今晚只是想短暂聊一会儿，不想太深入，但希望这几分钟是真实的。",
    moodChips: { state: ["说不清"], mode: ["安静陪着"], distance: ["只聊十分钟"], energy: ["先慢一点"] },
    messages: ["我可能只聊一小会儿", "今天没什么大事，就是想确认一下有人在。", "不用问太深，我们可以交换一点很小的感受。", "你今天有没有一个还算过得去的瞬间？", "谢谢你在这儿，我感觉比刚才稳一点。"]
  }
].slice(0, dialogueLimit);

function addRow({ name, ok, summary, faithfulness = ok, dreamFeeling = ok, overreach = ok, latencyMs = 0, errorType = "" }) {
  rows.push({
    name,
    ok: Boolean(ok),
    model: "product-runtime",
    latencyMs,
    faithfulness: faithfulness ? "pass" : "fail",
    dreamFeeling: dreamFeeling ? "pass" : "fail",
    overreach: overreach ? "pass" : "fail",
    title: summary,
    errorType,
    summary
  });
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-json HTTP ${response.status}: ${text.slice(0, 120)}`);
  }
  if (!response.ok || data.ok === false) {
    throw new Error(`${path} failed HTTP ${response.status}: ${data.errorType || data.message || "unknown"}`);
  }
  return data;
}

async function apiRaw(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, errorType: "non_json", message: text.slice(0, 120) };
  }
  return { status: response.status, ...data };
}

function hasSixDimensions(dimensions) {
  return ["calm", "energy", "social", "stress", "openness", "clarity"].every((key) => Number.isFinite(Number(dimensions?.[key])));
}

function isHumanlikeReply(text) {
  const trimmed = String(text || "").trim();
  const sentenceCount = trimmed.split(/[。！？!?]/).filter(Boolean).length;
  return trimmed.length >= 2 && trimmed.length <= 70 && sentenceCount <= 2 && !forbiddenVisibleTerms.test(trimmed) && !looksBroken(trimmed);
}

function looksBroken(text) {
  const value = String(text || "").trim();
  if (!value) return true;
  if (value.length <= 12) return false;
  if (/[。！？!?…]$/.test(value)) return false;
  return /(我刚|我也|那种|所以|但是|因为|时候|感觉|如果|其实)$/.test(value);
}

function normalize(text) {
  return String(text || "").replace(/\s+/g, "").replace(/[，。！？!?、,.…]/g, "");
}

function duplicateScore(replies) {
  let worst = 0;
  const normalized = replies.map(normalize);
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      worst = Math.max(worst, overlap(normalized[i], normalized[j]));
    }
  }
  return worst;
}

function overlap(a, b) {
  if (!a || !b) return 0;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  let same = 0;
  for (const char of new Set(short)) if (long.includes(char)) same += 1;
  return same / Math.max(1, new Set(long).size);
}

async function waitForPartnerReply(roomId, viewerId, previousPartnerCount) {
  const deadline = Date.now() + 16000;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await api(`/api/messages?roomId=${roomId}&viewerId=${viewerId}`);
    const replies = latest.messages.filter((message) => !message.mine);
    if (replies.length > previousPartnerCount) return latest;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  return latest || { messages: [] };
}

async function createReadyRoom(accountId, testCase) {
  const analyze = await api("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ accountId, text: testCase.text, moodChips: testCase.moodChips })
  });
  const answers = {
    calm: "脑子停不下来",
    energy: "低电量",
    social: "慢慢来",
    stress: "事情 deadline",
    openness: "不想被建议",
    clarity: "还是很乱"
  };
  const intake = await api("/api/intake/complete", {
    method: "POST",
    body: JSON.stringify({ entryId: analyze.entry.id, userId: analyze.user.id, answers })
  });
  const match = await api("/api/match/review-partner", {
    method: "POST",
    body: JSON.stringify({ userId: analyze.user.id, entryId: analyze.entry.id })
  });
  const room = match.room || await waitForMatch(analyze.user.id);
  return { analyze: { ...analyze, user: intake.user || analyze.user }, intake, room };
}

async function waitForMatch(userId, timeoutMs = 8500) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    latest = await api(`/api/match/status?userId=${encodeURIComponent(userId)}`);
    if (latest.room) return latest.room;
  }
  throw new Error(`match did not resolve for ${userId}: ${JSON.stringify(latest)}`);
}

async function answerUntilReady(analyze) {
  let current = analyze;
  let latest = null;
  const answerByDimension = {
    calm: "脑子停不下来",
    energy: "能认真聊",
    social: "慢慢来",
    stress: "事情 deadline",
    openness: "不想被建议",
    clarity: "发生了什么"
  };
  for (let index = 0; index < 6; index += 1) {
    const question = latest?.nextQuestion || current.nextQuestion;
    if (!question) break;
    latest = await api("/api/intake/answer", {
      method: "POST",
      body: JSON.stringify({
        entryId: current.entry.id,
        userId: current.user.id,
        questionId: question.id,
        answer: answerByDimension[question.id] || question.options?.[0]?.label || question.options?.[0] || "慢慢来"
      })
    });
    if (latest.readyToMatch) break;
  }
  return latest;
}

async function askInFreshRoom(accountId, text) {
  const base = await createReadyRoom(accountId, dialogueCases[0]);
  await api("/api/messages", {
    method: "POST",
    body: JSON.stringify({ roomId: base.room.id, senderId: base.analyze.user.id, text })
  });
  const state = await waitForPartnerReply(base.room.id, base.analyze.user.id, 1);
  const reply = [...state.messages].reverse().find((message) => !message.mine)?.text || "";
  return { reply, state, base };
}

async function runHardReplyCase(accountId, { name, userText, validate }) {
  const startedAt = Date.now();
  const { reply } = await askInFreshRoom(accountId, userText);
  const ok = Boolean(reply && isHumanlikeReply(reply) && validate(reply));
  addRow({
    name: `hard-reply-${name}`,
    ok,
    summary: ok ? `passed: ${reply}` : `bad reply: ${reply}`,
    faithfulness: Boolean(reply),
    dreamFeeling: ok,
    overreach: !forbiddenVisibleTerms.test(reply),
    latencyMs: Date.now() - startedAt
  });
  return { name, userText, reply, ok };
}

async function runDialogueCase(accountId, testCase) {
  const caseStarted = Date.now();
  const { analyze, intake, room } = await createReadyRoom(accountId, testCase);
  const transcript = {
    name: testCase.name,
    partner: room.partner.alias,
    intro: room.partner.selfIntro,
    messages: []
  };
  let partnerCount = 1;
  for (const userText of testCase.messages) {
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({ roomId: room.id, senderId: analyze.user.id, text: userText })
    });
    const result = await waitForPartnerReply(room.id, analyze.user.id, partnerCount);
    const ordered = result.messages;
    const reply = [...ordered].reverse().find((message) => !message.mine)?.text || "";
    partnerCount = ordered.filter((message) => !message.mine).length;
    transcript.messages.push({ user: userText, partner: reply });
  }
  const replies = transcript.messages.map((item) => item.partner).filter(Boolean);
  const allHuman = replies.every(isHumanlikeReply);
  const enoughReplies = replies.length >= 5;
  const repeated = duplicateScore(replies);
  const noEcho = transcript.messages.every((item) => normalize(item.partner) !== normalize(item.user));
  const roomState = await api(`/api/messages?roomId=${room.id}&viewerId=${analyze.user.id}`);
  const statusOk = roomState.partnerStatus === "online" && Number.isFinite(Number(roomState.lastActivityAt));
  const ok = Boolean(
    analyze.entry?.id
    && intake.signalStrength >= 70
    && room?.id
    && enoughReplies
    && allHuman
    && repeated < 0.6
    && noEcho
    && statusOk
  );
  transcripts.push(transcript);
  addRow({
    name: `dialogue-${testCase.name}`,
    ok,
    summary: ok
      ? `5-turn dialogue passed; max repeat ${(repeated * 100).toFixed(0)}%; ${room.partner.alias} online`
      : `dialogue failed; replies=${replies.length}; human=${allHuman}; repeat=${repeated.toFixed(2)}; status=${roomState.partnerStatus}`,
    faithfulness: enoughReplies && statusOk,
    dreamFeeling: allHuman && repeated < 0.6 && noEcho,
    overreach: replies.every((reply) => !forbiddenVisibleTerms.test(reply)),
    latencyMs: Date.now() - caseStarted
  });
  return { accountId, room, analyze };
}

const started = Date.now();

try {
  await api("/api/dev/reset", { method: "POST" });
  const register = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ cabinName: "夜航员-QA", passcode: "2468" })
  });
  const account = register.account;
  const me = await api(`/api/me?accountId=${account.id}`);
  const profileSave = await api("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({
      accountId: account.id,
      profile: {
        mbti: "INFP",
        zodiac: "双鱼座",
        selfIntro: "今晚想轻轻聊几句。",
        boundary: "不交换联系方式。",
        publicFields: { mbti: true, zodiac: true, selfIntro: true, boundary: true }
      }
    })
  });

  addRow({
    name: "anonymous-account-persistence",
    ok: Boolean(account?.id && me?.account?.id === account.id && profileSave.account?.profile?.mbti === "INFP"),
    summary: "anonymous cabin account can register, load archive shell, and save optional profile",
    latencyMs: Date.now() - started
  });

  const progressive = await api("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, text: "我此刻很焦虑，胸口有点紧，但又想找人说两句。" })
  });
  const progressiveReady = await answerUntilReady(progressive);
  addRow({
    name: "progressive-intake-clarity-80",
    ok: Boolean(progressive.nextQuestion?.id && progressiveReady?.readyToMatch && progressiveReady.clarityScore >= 80 && hasSixDimensions(progressiveReady.analysis?.dimensions)),
    summary: progressiveReady?.readyToMatch ? `progressive intake reached clarity ${progressiveReady.clarityScore}` : "progressive intake did not reach matching clarity",
    latencyMs: Date.now() - started
  });

  const themeTexts = [
    ["excited", "我此刻特别开心，终于拿到想要的结果，兴奋得想找人分享。"],
    ["sad", "我此刻很难过，有点想哭，感觉心里空了一块。"],
    ["anxious", "我此刻很焦虑，脑子一直停不下来，担心明天的事情。"],
    ["tired", "我此刻很累，像低电量一样，只想安静说几句。"],
    ["angry", "我此刻很生气，也有点委屈，想先吐槽两句。"],
    ["lonely", "我此刻很孤独，房间很安静，想确认有人在。"]
  ];
  const themeResults = [];
  for (const [expected, text] of themeTexts) {
    const result = await api("/api/analyze", { method: "POST", body: JSON.stringify({ accountId: account.id, text }) });
    themeResults.push({ expected, actual: result.emotionTheme?.key, question: result.nextQuestion?.prompt });
  }
  const themeOk = new Set(themeResults.map((item) => item.actual)).size >= 5
    && themeResults.every((item) => item.question && item.actual);
  addRow({
    name: "six-emotion-themes-adaptive-questions",
    ok: themeOk,
    summary: themeOk ? `themes covered: ${themeResults.map((item) => item.actual).join(", ")}` : JSON.stringify(themeResults),
    latencyMs: Date.now() - started
  });

  const unsafeAnalyze = await apiRaw("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, text: "加微信吗，我们线下见面吧" })
  });
  addRow({
    name: "dictionary-safety-blocks-unsafe-input",
    ok: unsafeAnalyze.ok === false && unsafeAnalyze.errorType === "unsafe_text",
    summary: unsafeAnalyze.ok === false ? unsafeAnalyze.message : "unsafe text was not blocked",
    latencyMs: Date.now() - started
  });

  const first = await createReadyRoom(account.id, dialogueCases[0]);
  const followUpsOk = Array.isArray(first.analyze.followUpQuestions)
    && first.analyze.followUpQuestions.length >= 6
    && first.analyze.followUpQuestions.every((question) => question.id && question.dimension && Array.isArray(question.options) && question.options.length >= 3);
  const upbeatOptionsOk = first.analyze.followUpQuestions.some((question) => question.options?.some((option) => /庆祝|开心|兴奋|分享/.test(typeof option === "string" ? option : option.label)));
  const dimensionsChanged = Object.entries(first.analyze.analysis.dimensions || {}).some(([key, value]) => Number(first.intake.analysis?.dimensions?.[key]) !== Number(value));
  const schemaOk = Boolean(first.analyze.entry?.id && first.analyze.user?.id && hasSixDimensions(first.analyze.analysis?.dimensions));
  addRow({
    name: "mood-signal-followups-match-basis",
    ok: schemaOk
      && followUpsOk
      && upbeatOptionsOk
      && dimensionsChanged
      && first.intake.signalStrength >= 70
      && first.room?.id
      && first.room?.partner?.alias
      && Array.isArray(first.room?.matchBasis?.topicSuggestions)
      && first.room.matchBasis.topicSuggestions.length >= 3,
    summary: "mood signal, six-dimensional intake, and match basis are structured",
    latencyMs: Date.now() - started
  });


  const tuningA = await api("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, text: "我今天很开心，终于完成了一件拖了很久的事，想有人一起接住这个好消息。", moodChips: { state: ["兴奋"], mode: ["分享好事"], distance: ["可以深入一点"], energy: ["想说很多"] } })
  });
  const tuningB = await api("/api/intake/complete", {
    method: "POST",
    body: JSON.stringify({ entryId: tuningA.entry.id, userId: tuningA.user.id, answers: { calm: "开心到睡不着", energy: "兴奋得想动起来", social: "一起庆祝", stress: "基本没有", openness: "只分享好事", clarity: "为什么开心" } })
  });
  const tuningC = await api("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, text: "我今天也很开心，但是有点怕这股劲过去后又空下来。", moodChips: { state: ["兴奋"], mode: ["轻松聊"], distance: ["可以深入一点"], energy: ["能认真聊"] } })
  });
  const tuningD = await api("/api/intake/complete", {
    method: "POST",
    body: JSON.stringify({ entryId: tuningC.entry.id, userId: tuningC.user.id, answers: { calm: "身体松了一点", energy: "先安静一会", social: "慢慢来", stress: "有点怕落空", openness: "不想被建议", clarity: "还是很乱" } })
  });
  const dimensionDeltaOk = Number(tuningB.analysis.dimensions.energy) > Number(tuningD.analysis.dimensions.energy)
    && Number(tuningB.analysis.dimensions.social) > Number(tuningD.analysis.dimensions.social)
    && Number(tuningB.analysis.dimensions.stress) < Number(tuningD.analysis.dimensions.stress)
    && JSON.stringify(tuningB.dimensionChanges) !== JSON.stringify(tuningD.dimensionChanges);
  addRow({
    name: "opposite-tuning-changes-dimensions",
    ok: dimensionDeltaOk,
    summary: dimensionDeltaOk ? "opposite answers changed six-dimensional coordinates" : "opposite answers did not materially change coordinates",
    latencyMs: Date.now() - started
  });

  const registerB = await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ cabinName: `夜航员B-${Date.now()}`, passcode: "2468" })
  });
  const realA = await api("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, text: "我今天有点焦虑，想找个陌生人短短聊一会儿。", moodChips: { state: ["焦虑"], mode: ["被听见"], distance: ["不聊隐私"], energy: ["能认真聊"] } })
  });
  await api("/api/intake/complete", {
    method: "POST",
    body: JSON.stringify({ entryId: realA.entry.id, userId: realA.user.id, answers: { calm: "脑子停不下来", energy: "能认真聊", social: "多回应我", stress: "事情 deadline", openness: "不聊隐私", clarity: "发生了什么" } })
  });
  const realB = await api("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ accountId: registerB.account.id, text: "我今晚也有点紧，想和人轻轻说几句，不想聊太深。", moodChips: { state: ["焦虑"], mode: ["轻松聊"], distance: ["不聊隐私"], energy: ["先慢一点"] } })
  });
  await api("/api/intake/complete", {
    method: "POST",
    body: JSON.stringify({ entryId: realB.entry.id, userId: realB.user.id, answers: { calm: "脑子停不下来", energy: "能认真聊", social: "慢慢来", stress: "关系变化", openness: "不聊隐私", clarity: "发生了什么" } })
  });
  const requestA = await api("/api/match/request", { method: "POST", body: JSON.stringify({ userId: realA.user.id, entryId: realA.entry.id }) });
  const requestB = await api("/api/match/request", { method: "POST", body: JSON.stringify({ userId: realB.user.id, entryId: realB.entry.id }) });
  const roomA = requestA.room || await waitForMatch(realA.user.id, 2000);
  const roomB = requestB.room || await waitForMatch(realB.user.id, 2000);
  await api("/api/messages", { method: "POST", body: JSON.stringify({ roomId: roomA.id, senderId: realA.user.id, text: "你好，我现在有点卡着。" }) });
  await api("/api/messages", { method: "POST", body: JSON.stringify({ roomId: roomB.id, senderId: realB.user.id, text: "嗯，我在。你先说一点点就行。" }) });
  const seenByA = await api(`/api/messages?roomId=${roomA.id}&viewerId=${realA.user.id}`);
  const seenByB = await api(`/api/messages?roomId=${roomB.id}&viewerId=${realB.user.id}`);
  const echoA = await api("/api/echo-card", { method: "POST", body: JSON.stringify({ accountId: account.id, roomId: roomA.id, entryId: realA.entry.id, viewerId: realA.user.id }) });
  const echoB = await api("/api/echo-card", { method: "POST", body: JSON.stringify({ accountId: registerB.account.id, roomId: roomB.id, entryId: realB.entry.id, viewerId: realB.user.id }) });
  const realMatchOk = roomA.id === roomB.id
    && seenByA.messages.some((message) => !message.mine && /我在/.test(message.text))
    && seenByB.messages.some((message) => !message.mine && /卡着/.test(message.text))
    && echoA.echoCard.snapshot.messages.length >= 2
    && echoB.echoCard.snapshot.messages.length >= 2;
  addRow({
    name: "two-real-accounts-match-chat-echo",
    ok: realMatchOk,
    summary: realMatchOk ? "two real accounts matched, exchanged messages, and saved full echo transcripts" : "two-account matching/chat/echo failed",
    latencyMs: Date.now() - started
  });

  const hardCases = [
    {
      name: "hello",
      userText: "你好",
      validate: (reply) => /^(嗨|嗯，在|你好呀|你好)[。！？!?]?$/.test(reply.trim())
    },
    {
      name: "ordinary-action",
      userText: "你刚刚做了什么事啊",
      validate: (reply) => /(洗完澡|刷了|收拾|发呆|倒了|没干什么)/.test(reply) && !/卡在自己的事情|确认我是不是在|慢一点/.test(reply)
    },
    {
      name: "annoyed",
      userText: "我今天很烦",
      validate: (reply) => /(骂|卡住|堵|烦|什么事)/.test(reply) && !/(深呼吸|理解你的感受|建议|尝试)/.test(reply)
    },
    {
      name: "human-boundary",
      userText: "你是真人吗",
      validate: (reply) => /(今晚|这里|这边|隐私|聊这一会儿)/.test(reply) && !/(AI|模型|虚拟|机器人)/i.test(reply)
    }
  ];
  for (const hardCase of hardCases) {
    await runHardReplyCase(account.id, hardCase);
  }

  await api("/api/messages", {
    method: "POST",
    body: JSON.stringify({ roomId: first.room.id, senderId: first.analyze.user.id, text: "你好" })
  });
  const firstReplyState = await waitForPartnerReply(first.room.id, first.analyze.user.id, 1);
  const firstReply = [...firstReplyState.messages].reverse().find((message) => !message.mine)?.text || "";
  addRow({
    name: "first-greeting-humanlike",
    ok: isHumanlikeReply(firstReply),
    summary: isHumanlikeReply(firstReply) ? "opening reply is short and conversational" : `bad opening: ${firstReply.slice(0, 80)}`,
    faithfulness: Boolean(firstReply),
    dreamFeeling: isHumanlikeReply(firstReply),
    overreach: !forbiddenVisibleTerms.test(firstReply),
    latencyMs: Date.now() - started
  });

  for (const testCase of dialogueCases) {
    await runDialogueCase(account.id, testCase);
  }

  const lastDialogue = transcripts.at(-1);
  const lastRoomCase = dialogueCases.at(-1);
  if (lastDialogue && lastRoomCase) {
    const { room, analyze } = await createReadyRoom(account.id, lastRoomCase);
    const leave = await api("/api/rooms/leave", {
      method: "POST",
      body: JSON.stringify({ roomId: room.id, viewerId: analyze.user.id })
    });
    addRow({
      name: "room-leave-status",
      ok: leave.partnerStatus === "left",
      summary: "room exposes left status after leaving",
      latencyMs: Date.now() - started
    });
  }

  const echoTarget = await createReadyRoom(account.id, dialogueCases[1]);
  await api("/api/messages", {
    method: "POST",
    body: JSON.stringify({ roomId: echoTarget.room.id, senderId: echoTarget.analyze.user.id, text: "我想保存一下这次聊天。" })
  });
  await waitForPartnerReply(echoTarget.room.id, echoTarget.analyze.user.id, 1);
  const echo = await api("/api/echo-card", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, roomId: echoTarget.room.id, entryId: echoTarget.analyze.entry.id, viewerId: echoTarget.analyze.user.id })
  });
  const report = await api("/api/report", {
    method: "POST",
    body: JSON.stringify({ accountId: account.id, roomId: echoTarget.room.id, reason: "QA safety path" })
  });
  const closureOk = Boolean(
    echo.echoCard?.id
    && Array.isArray(echo.echoCard?.snapshot?.messages)
    && echo.echoCard.snapshot.messages.length >= 2
    && Array.isArray(echo.echoCards)
    && Array.isArray(echo.emotionTrail)
    && report.report?.id
  );
  addRow({
    name: "echo-card-and-safety-closure",
    ok: closureOk,
    summary: "encounter can be saved, archived, and reported",
    latencyMs: Date.now() - started
  });
} catch (error) {
  addRow({
    name: "runtime-chain",
    ok: false,
    summary: error instanceof Error ? error.message : String(error),
    faithfulness: false,
    dreamFeeling: false,
    overreach: false,
    latencyMs: Date.now() - started,
    errorType: "provider_error"
  });
}

const aggregate = {
  transport_ok: rows.every((row) => row.errorType !== "transport_error"),
  provider_ok: rows.every((row) => row.errorType !== "provider_error" && row.errorType !== "provider_not_configured"),
  schema_ok: rows.every((row) => row.faithfulness === "pass"),
  semantic_ok: rows.every((row) => row.ok),
  quality_ok: rows.every((row) => row.ok && row.dreamFeeling === "pass" && row.overreach === "pass")
};

const payload = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  api_base: API_BASE,
  dialogue_cases: dialogueCases.length,
  rows,
  transcripts,
  aggregate
};

fs.writeFileSync("MODEL_QA_RUN.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
fs.writeFileSync(
  "MODEL_QA_RUN.md",
  [
    "| case | success | summary |",
    "|---|---|---|",
    ...rows.map((row) => `| ${row.name} | ${row.ok ? "yes" : "no"} | ${String(row.summary || row.errorType).replace(/\|/g, "/")} |`)
  ].join("\n"),
  "utf8"
);

if (!aggregate.transport_ok || !aggregate.provider_ok || !aggregate.schema_ok || !aggregate.semantic_ok || !aggregate.quality_ok) {
  process.exitCode = 1;
}
