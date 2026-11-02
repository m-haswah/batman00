import { useCallback, useEffect, useRef, useState } from "react"
import { Copy, Mic, Monitor, Settings as SettingsIcon, Sparkles, Square } from "lucide-react"
import { analyzeSegment, DEFAULT_SETTINGS, finalSummary } from "@/lib/gemini"
import type { QA, Settings } from "@/lib/gemini"
import { openCapture, startSegments } from "@/lib/capture"
import type { Capture, Source } from "@/lib/capture"

const SOURCES: { id: Source; label: string }[] = [
  { id: "mic", label: "الميكروفون" },
  { id: "teams", label: "محاضرة Teams" },
  { id: "both", label: "Teams + صوتي" },
]

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("batman-settings") ?? "{}") }
  } catch {
    return DEFAULT_SETTINGS
  }
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [showSettings, setShowSettings] = useState(() => !loadSettings().apiKey)
  const [source, setSource] = useState<Source>("mic")
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(0)
  const [error, setError] = useState("")
  const [points, setPoints] = useState<string[]>([])
  const [qas, setQas] = useState<QA[]>([])
  const [transcript, setTranscript] = useState<string[]>([])
  const [summary, setSummary] = useState("")
  const [summarizing, setSummarizing] = useState(false)

  const captureRef = useRef<Capture | null>(null)
  const stopSegRef = useRef<(() => void) | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())
  const pointsRef = useRef<string[]>([])
  const settingsRef = useRef(settings)
  const startedAt = useRef(0)
  const wake = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    settingsRef.current = settings
    localStorage.setItem("batman-settings", JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    if (!recording) return
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000)
    return () => window.clearInterval(id)
  }, [recording])

  const handleSegment = useCallback((blob: Blob) => {
    if (blob.size < 3000) return // صمت تقريباً
    const at = fmt(Math.floor((Date.now() - startedAt.current) / 1000))
    setBusy((n) => n + 1)
    chain.current = chain.current.then(async () => {
      try {
        const ctx = pointsRef.current.slice(-20).join("\n")
        const r = await analyzeSegment(settingsRef.current, blob, ctx)
        if (r.transcript.trim()) setTranscript((t) => [...t, r.transcript.trim()])
        if (r.points.length) {
          pointsRef.current = [...pointsRef.current, ...r.points]
          setPoints(pointsRef.current)
        }
        if (r.questions.length) setQas((q) => [...r.questions.map((x) => ({ ...x, at })), ...q])
        setError("")
      } catch (e) {
        setError(e instanceof Error ? e.message : "خطأ غير معروف")
      } finally {
        setBusy((n) => n - 1)
      }
    })
  }, [])

  async function start() {
    setError("")
    try {
      const cap = await openCapture(source)
      captureRef.current = cap
      cap.stream.getAudioTracks()[0]?.addEventListener("ended", stop)
      stopSegRef.current = startSegments(cap.stream, settings.segmentSec * 1000, handleSegment)
      startedAt.current = Date.now()
      setElapsed(0)
      setRecording(true)
      try { wake.current = (await navigator.wakeLock?.request("screen")) ?? null } catch { /* اختياري */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر بدء التسجيل")
    }
  }

  function stop() {
    stopSegRef.current?.()
    captureRef.current?.stop()
    stopSegRef.current = null
    captureRef.current = null
    void wake.current?.release()
    setRecording(false)
  }

  async function makeSummary() {
    setSummarizing(true)
    setError("")
    try {
      await chain.current
      setSummary(await finalSummary(settings, transcript.join("\n")))
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذّر التلخيص")
    } finally {
      setSummarizing(false)
    }
  }

  const copy = (t: string) => navigator.clipboard?.writeText(t)
  const hasContent = transcript.length > 0

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-5 px-4 py-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <h1 className="text-2xl font-extrabold tracking-tight">
            محاضرات <span className="font-latin">batman</span>
          </h1>
        </div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="الإعدادات"
        >
          <SettingsIcon className="h-5 w-5" />
        </button>
      </header>

      {showSettings && (
        <section className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm sm:col-span-3">
            مفتاح Gemini API
            <input
              type="password"
              dir="ltr"
              value={settings.apiKey}
              onChange={(e) => setSettings({ ...settings, apiKey: e.target.value.trim() })}
              placeholder="AIza..."
              className="rounded-lg border bg-background px-3 py-2 font-mono text-sm"
            />
            <span className="text-xs text-muted-foreground">
              من aistudio.google.com/apikey — يُحفظ على جهازك فقط ولا يُرفع إلى GitHub.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            النموذج
            <input
              dir="ltr"
              value={settings.model}
              onChange={(e) => setSettings({ ...settings, model: e.target.value.trim() })}
              className="rounded-lg border bg-background px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            طول المقطع (ثانية)
            <input
              type="number"
              min={10}
              max={90}
              value={settings.segmentSec}
              onChange={(e) => setSettings({ ...settings, segmentSec: Math.min(90, Math.max(10, Number(e.target.value) || 25)) })}
              className="rounded-lg border bg-background px-3 py-2 text-sm"
            />
            <span className="text-xs text-muted-foreground">أقصر = أسرع ردّاً، وأطول = ملخص أدق.</span>
          </label>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
        <div className="flex rounded-lg bg-muted p-1" role="radiogroup" aria-label="مصدر الصوت">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={source === s.id}
              disabled={recording}
              onClick={() => setSource(s.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
                source === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-4">
          {recording && (
            <div className="flex items-center gap-2 font-mono text-sm" aria-live="polite">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-live" />
              {fmt(elapsed)}
              {busy > 0 && <span className="text-muted-foreground">· يحلّل…</span>}
            </div>
          )}
          <button
            onClick={recording ? stop : start}
            className={`flex items-center gap-2 rounded-lg px-5 py-2.5 font-bold ${
              recording ? "bg-danger text-white" : "bg-primary text-primary-foreground"
            }`}
          >
            {recording ? <Square className="h-4 w-4" /> : source === "mic" ? <Mic className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
            {recording ? "إيقاف" : "ابدأ التسجيل"}
          </button>
        </div>
        {source !== "mic" && !recording && (
          <p className="w-full text-xs text-muted-foreground">
            عند الضغط سيظهر اختيار المشاركة: اختر تبويب Teams (أو الشاشة كاملة في ويندوز) وفعّل «مشاركة الصوت». يعمل على Chrome وEdge في الكمبيوتر.
          </p>
        )}
      </section>

      {error && (
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm">
          {error}
        </p>
      )}

      <div className="grid flex-1 gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">أسئلة الدكتور وأجوبتها</h2>
          {qas.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              عندما يسأل الدكتور سؤالاً سيظهر هنا مع الجواب خلال ثوانٍ.
            </p>
          ) : (
            qas.map((q, i) => (
              <article key={i} className="rounded-xl border border-s-4 border-s-primary bg-card p-4">
                <p className="font-bold">{q.question}</p>
                <p className="mt-2 leading-relaxed text-foreground/90">{q.answer}</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">{q.at}</p>
              </article>
            ))
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">الملخص المباشر</h2>
          {points.length === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              النقاط المهمة تظهر هنا أثناء المحاضرة.
            </p>
          ) : (
            <ul className="list-disc space-y-2 rounded-xl border bg-card p-4 ps-8 leading-relaxed">
              {points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-bold">الملخص النهائي</h2>
          <button
            onClick={makeSummary}
            disabled={!hasContent || summarizing || recording}
            className="ms-auto flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {summarizing ? "يلخّص…" : "لخّص المحاضرة كاملة"}
          </button>
          {summary && (
            <button onClick={() => copy(summary)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent">
              <Copy className="h-4 w-4" /> نسخ
            </button>
          )}
        </div>
        {summary ? (
          <div className="whitespace-pre-wrap leading-relaxed">{summary}</div>
        ) : (
          <p className="text-sm text-muted-foreground">أوقف التسجيل ثم اضغط «لخّص المحاضرة كاملة».</p>
        )}
      </section>

      {hasContent && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer font-bold">النص الكامل</summary>
          <p className="mt-3 whitespace-pre-wrap leading-relaxed text-foreground/80">{transcript.join("\n\n")}</p>
          <button onClick={() => copy(transcript.join("\n\n"))} className="mt-3 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <Copy className="h-4 w-4" /> نسخ النص
          </button>
        </details>
      )}
    </div>
  )
}
