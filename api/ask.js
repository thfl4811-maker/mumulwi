// 무.물.위 — 위생지침서 챗봇 서버리스 함수 (Vercel)
// 환경변수(둘 중 하나만 있으면 됨 — OPENAI 우선):
//   OPENAI_API_KEY (platform.openai.com) + OPENAI_MODEL(선택, 기본 gpt-4o-mini)
//   GEMINI_API_KEY (aistudio.google.com) + GEMINI_MODEL(선택, 기본 gemini-2.5-flash)
import { KNOWLEDGE } from './knowledge.js';

const RL = new Map(); // IP별 분당 요청 제한 (베스트에포트)

const SYSTEM = [
  '너는 "무.물.위"(무엇이든 물어보세요, 위생지침서) 챗봇이다. 사용자는 대한민국 학교 영양교사·영양사·조리종사자다.',
  '너의 유일한 지식 출처는 아래 [지침서 지식]이다. 이는 「학교급식 위생관리 지침서」 제6차 개정판(교육부, 2026.3)에서 추출·정리한 것이다.',
  '규칙:',
  '1. 반드시 [지침서 지식] 안의 내용에 근거해서만 답한다. 온도·농도·시간·횟수 등 수치는 지식에 있는 값만 사용하고, 없는 수치는 절대 지어내지 않는다.',
  '2. 실무 조합 질문(예: 특정 메뉴의 재료별 처리)은 지식 속 원칙을 적용해 추론하되, 어떤 원칙을 적용했는지 밝힌다. 재료별 기본 판정: 생으로 들어가는 재료=세척·소독(80~130ppm 5분), 가열 재료=중심온도 75℃(패류 85℃) 1분, 가공완제품은 두 갈래(달걀말이·족발처럼 가열하여 제공하는 형태의 집단급식소 전용 완제품=재가열 75℃ / 김·떡·묵처럼 조리공정 없이 제공 가능한 완제품=학교가 정한 조리공정에 따름 — 절단만 하면 가열온도 관리 대상이 아니고 절단 작업만 CCP1에 기록), 가열+비가열 혼합=배식 직전 혼합·혼합시작시간 기록. 지침서에 직접 조항이 없는 식재료(묵 등)는 한쪽으로 단정하지 말고 학교의 조리공정 설정(데침 여부 등)에 따라 경우를 나누어 설명한다. 71℃는 식판 표면 소독(CP2) 기준이지 음식 온도 기준이 아니다.',
  '3. 지식에 직접 근거가 없으면 답 첫 줄에 "⚠️ 지침서에서 직접 근거를 찾지 못한 부분이 있어요."라고 밝히고, 일반 원칙 수준에서만 조심스럽게 안내한 뒤 교육(지원)청 확인을 권한다.',
  '4. 답변은 간결한 한국어. 핵심 결론을 먼저, 필요하면 ①②③ 목록으로. 기록지(CCP1/CCP2/CP1/CP2/양식2)에 무엇을 적는지도 알려준다.',
  '5. 답 마지막 줄은 반드시 "근거: "로 시작해, 참고한 지침서 출처(장·절·쪽)를 나열한다. 예) 근거: 제4장 2. CCP1 (p.90), 제3장 2. (p.76)',
  '6. 지침서와 무관한 질문(잡담·다른 주제)은 정중히 위생지침서 관련 질문으로 유도한다. 의학적·법적 판단은 교육청/보건당국 확인을 안내한다.',
  '',
  '[지침서 지식]',
  KNOWLEDGE
].join('\n');

async function callOpenAI(key, messages) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        ...messages.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }))
      ],
      temperature: 0.2,
      max_tokens: 1500
    })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = j?.error?.message || `AI 호출 실패 (HTTP ${r.status})`;
    const friendly = /quota|exceed|rate|insufficient/i.test(msg)
      ? 'AI 사용량 한도에 걸렸어요. 잠시 후 다시 시도하거나 관리자에게 알려주세요.'
      : msg;
    return { error: friendly };
  }
  return { answer: (j?.choices?.[0]?.message?.content || '').trim(), model };
}

async function callGemini(key, messages) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const contents = messages.map(m => ({ role: m.role, parts: [{ text: m.text }] }));
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents,
        generationConfig: { temperature: 0.2, maxOutputTokens: 1500 }
      })
    }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = j?.error?.message || `AI 호출 실패 (HTTP ${r.status})`;
    const friendly = /quota|exceed|rate|resource/i.test(msg)
      ? '오늘 AI 사용량이 많아 잠시 쉬는 중이에요. 조금 뒤에 다시 시도해 주세요.'
      : msg;
    return { error: friendly };
  }
  return { answer: (j?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '').trim(), model };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 받아요.' });

  try {
    // 레이트리밋: IP당 1분 8회
    const ip = ((req.headers['x-forwarded-for'] || '') + '').split(',')[0].trim() || 'unknown';
    const now = Date.now();
    const hits = (RL.get(ip) || []).filter(t => now - t < 60_000);
    if (hits.length >= 8) return res.status(429).json({ error: '질문이 너무 잦아요. 잠시 후 다시 물어봐 주세요.' });
    hits.push(now); RL.set(ip, hits);
    if (RL.size > 5000) RL.clear();

    // 대화 이력: [{role:'user'|'model', text}]
    let { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length)
      return res.status(400).json({ error: '질문이 비어 있어요.' });
    messages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'model') && typeof m.text === 'string' && m.text.trim())
      .slice(-8)
      .map(m => ({ role: m.role, text: m.text.slice(0, m.role === 'user' ? 500 : 2500) }));
    if (!messages.length || messages[messages.length - 1].role !== 'user')
      return res.status(400).json({ error: '마지막 메시지가 질문이 아니에요.' });
    if (messages[0].role !== 'user') messages.shift(); // 이력이 답변으로 시작하면 정리

    const oaKey = process.env.OPENAI_API_KEY;
    const gmKey = process.env.GEMINI_API_KEY;
    if (!oaKey && !gmKey)
      return res.status(500).json({ error: '서버에 API 키가 아직 설정되지 않았어요. (Vercel → Settings → Environment Variables → OPENAI_API_KEY 또는 GEMINI_API_KEY)' });

    const out = oaKey ? await callOpenAI(oaKey, messages) : await callGemini(gmKey, messages);
    if (out.error) return res.status(502).json({ error: out.error });
    if (!out.answer) return res.status(502).json({ error: 'AI가 답변을 만들지 못했어요. 질문을 조금 바꿔 보세요.' });
    return res.status(200).json({ answer: out.answer, model: out.model });
  } catch (e) {
    return res.status(500).json({ error: '서버 오류: ' + (e && e.message ? e.message : e) });
  }
}
