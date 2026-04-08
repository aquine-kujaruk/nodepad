"use client"

import { loadAIConfig, getGeminiNativeUrl, getGeminiNativeHeaders } from "@/lib/ai-settings"

export interface AudioRecorder {
  start(): Promise<void>
  stop(): Promise<Blob>
  isRecording(): boolean
}

export function createAudioRecorder(): AudioRecorder {
  let mediaRecorder: MediaRecorder | null = null
  let chunks: BlobEvent["data"][] = []
  let stream: MediaStream | null = null

  return {
    async start() {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : undefined

      mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      chunks = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      mediaRecorder.start(1000)
    },

    stop(): Promise<Blob> {
      return new Promise((resolve) => {
        if (!mediaRecorder) {
          resolve(new Blob())
          return
        }

        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mediaRecorder!.mimeType || "audio/webm" })
          stream?.getTracks().forEach((t) => t.stop())
          stream = null
          mediaRecorder = null
          resolve(blob)
        }

        mediaRecorder.stop()
      })
    },

    isRecording() {
      return mediaRecorder?.state === "recording"
    },
  }
}

async function webmToWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer()
  const audioCtx = new AudioContext()
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
  await audioCtx.close()

  const sampleRate = 16000
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * sampleRate, sampleRate)
  const source = offlineCtx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offlineCtx.destination)
  source.start()

  const rendered = await offlineCtx.startRendering()
  const pcmData = rendered.getChannelData(0)

  const pcm16 = new Int16Array(pcmData.length)
  for (let i = 0; i < pcmData.length; i++) {
    pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(pcmData[i] * 32767)))
  }

  const wavHeader = new ArrayBuffer(44)
  const view = new DataView(wavHeader)
  const numChannels = 1
  const byteRate = sampleRate * numChannels * 2
  const dataSize = pcm16.byteLength

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }
  writeStr(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, "WAVE")
  writeStr(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, numChannels * 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, "data")
  view.setUint32(40, dataSize, true)

  return new Blob([wavHeader, pcm16.buffer], { type: "audio/wav" })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const config = loadAIConfig()
  if (!config) throw new Error("No API key configured")

  const wavBlob = await webmToWav(blob)
  const base64 = await blobToBase64(wavBlob)

  const url = getGeminiNativeUrl(config.modelId)
  const headers = getGeminiNativeHeaders(config.apiKey)

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: "Generate a transcript of the speech. Output ONLY the transcribed text, no commentary, no labels, no timestamps. Apply proper punctuation and capitalization.",
            },
            {
              inline_data: {
                mime_type: "audio/wav",
                data: base64,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 4096,
      },
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini transcription failed: ${response.status} ${err}`)
  }

  const data = await response.json()
  const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
  return text.trim()
}
