export type Source = "mic" | "teams" | "both"

export interface Capture { stream: MediaStream; stop: () => void }

export async function openCapture(source: Source): Promise<Capture> {
  const toStop: MediaStream[] = []
  let ctx: AudioContext | null = null

  if (source !== "mic" && !navigator.mediaDevices.getDisplayMedia) {
    throw new Error("هذا الجهاز/المتصفح لا يدعم التقاط صوت Teams. استخدم الميكروفون، أو افتح التطبيق من Chrome أو Edge على الكمبيوتر.")
  }

  let mic: MediaStream | null = null
  let screen: MediaStream | null = null
  if (source !== "teams") {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    toStop.push(mic)
  }
  if (source !== "mic") {
    screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    toStop.push(screen)
    if (screen.getAudioTracks().length === 0) {
      toStop.forEach((m) => m.getTracks().forEach((t) => t.stop()))
      throw new Error("لم تتم مشاركة الصوت. اختر تبويب Teams (أو الشاشة كاملة في ويندوز) وفعّل «مشاركة صوت التبويب/النظام».")
    }
  }

  let stream: MediaStream
  if (mic && screen) {
    ctx = new AudioContext()
    const dest = ctx.createMediaStreamDestination()
    ctx.createMediaStreamSource(new MediaStream(mic.getAudioTracks())).connect(dest)
    ctx.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(dest)
    stream = dest.stream
  } else {
    stream = new MediaStream((mic ?? screen)!.getAudioTracks())
  }

  return {
    stream,
    stop: () => {
      toStop.forEach((m) => m.getTracks().forEach((t) => t.stop()))
      void ctx?.close()
    },
  }
}

/** يقطع الصوت إلى مقاطع مستقلة قابلة للتشغيل، كل مقطع كل ms مللي ثانية. */
export function startSegments(stream: MediaStream, ms: number, onSegment: (b: Blob) => void): () => void {
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t))
  let active = true
  let rec: MediaRecorder | null = null
  let timer = 0

  const begin = () => {
    if (!active) return
    const parts: BlobPart[] = []
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    rec = r
    r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data) }
    r.onstop = () => onSegment(new Blob(parts, { type: r.mimeType || mime || "audio/webm" }))
    r.start()
    timer = window.setTimeout(() => { r.stop(); begin() }, ms)
  }
  begin()

  return () => {
    active = false
    window.clearTimeout(timer)
    if (rec && rec.state !== "inactive") rec.stop()
  }
}
