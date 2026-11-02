export interface Settings {
  apiKey: string
  model: string
  segmentSec: number
}
export interface QA { question: string; answer: string; at: string }
export interface SegmentResult {
  transcript: string
  points: string[]
  questions: { question: string; answer: string }[]
}

export const DEFAULT_SETTINGS: Settings = { apiKey: "", model: "gemini-2.5-flash", segmentSec: 25 }

const SCHEMA = {
  type: "OBJECT",
  properties: {
    transcript: { type: "STRING" },
    points: { type: "ARRAY", items: { type: "STRING" } },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { question: { type: "STRING" }, answer: { type: "STRING" } },
        required: ["question", "answer"],
      },
    },
  },
  required: ["transcript", "points", "questions"],
}

const SYSTEM = `أنت مساعد لطالب جامعي يحضر محاضرة مباشرة. ستصلك مقطع صوتي قصير من المحاضرة (قد يكون بالعربية أو الإنجليزية أو خليط).
أرجع JSON فقط:
- transcript: نص ما قيل حرفياً بلغته الأصلية (فارغ إن لم يكن هناك كلام).
- points: نقاط جديدة مهمة من هذا المقطع فقط، بالعربية، قصيرة ومباشرة (فارغة إن لم يكن هناك جديد).
- questions: فقط الأسئلة التي وجّهها المحاضر للطلاب أو للقاعة أو طرحها كتحدٍّ للتفكير. لكل سؤال: نص السؤال، وجواب صحيح ومختصر بالعربية (جملة إلى ثلاث). لا تضع أسئلة الطلاب العادية ولا الأسئلة البلاغية البسيطة.
اعتمد على الملخص السابق كسياق ولا تكرر ما ورد فيه.`

async function callGemini(s: Settings, body: unknown): Promise<string> {
  if (!s.apiKey) throw new Error("أضف مفتاح Gemini من الإعدادات أولاً")
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": s.apiKey },
      body: JSON.stringify(body),
    },
  )
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error?.message ?? `خطأ ${res.status} من Gemini`)
  const parts: { text?: string }[] = json?.candidates?.[0]?.content?.parts ?? []
  return parts.map((p) => p.text ?? "").join("")
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(new Error("تعذّرت قراءة الصوت"))
    r.readAsDataURL(blob)
  })
}

export async function analyzeSegment(s: Settings, audio: Blob, context: string): Promise<SegmentResult> {
  const text = await callGemini(s, {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: `الملخص السابق:\n${context || "(بداية المحاضرة)"}` },
          { inlineData: { mimeType: audio.type.split(";")[0] || "audio/webm", data: await toBase64(audio) } },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
  })
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim()) as Partial<SegmentResult>
  return {
    transcript: parsed.transcript ?? "",
    points: parsed.points ?? [],
    questions: parsed.questions ?? [],
  }
}

export async function finalSummary(s: Settings, transcript: string): Promise<string> {
  return callGemini(s, {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `هذا نص محاضرة كاملة. اكتب ملخصاً منظماً بالعربية: عنوان، أهم المحاور، التعريفات والقوانين المهمة، وما قد يأتي في الامتحان. اجعله مناسباً للمراجعة السريعة.\n\n${transcript}`,
          },
        ],
      },
    ],
  })
}
