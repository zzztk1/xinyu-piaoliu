const blockedPatterns = [
  { pattern: /(微信|vx|v信|qq|手机号|电话|加我|联系方式)/i, reason: "这里先不交换联系方式，留在漂流舱里聊会儿更安全。" },
  { pattern: /(见面|线下|开房|约炮|裸聊|成人视频|黄色)/i, reason: "这句话越过了安全边界，换个轻一点的话题吧。" },
  { pattern: /(杀了|弄死|自杀|轻生|割腕|跳楼|伤害自己|不想活)/i, reason: "这段内容可能有危险信号，请先联系身边可信的人或当地紧急支持。" },
  { pattern: /(傻逼|操你|妈的|滚你|死全家|废物)/i, reason: "这句话太冲了，先换一种不会伤人的说法。" }
];

export function checkSafetyText(text) {
  const value = String(text || "").trim();
  const hit = blockedPatterns.find((item) => item.pattern.test(value));
  if (!hit) return { ok: true, reason: "" };
  return { ok: false, reason: hit.reason };
}
