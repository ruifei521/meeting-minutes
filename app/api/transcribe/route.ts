import { NextResponse } from 'next/server';
import { redis, MeetingData } from '@/lib/redis';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function cleanText(text: string): string {
  return text.replace(/[\uFEFF\u200B\u00A0]/g, '').trim();
}

// 进度上报工具函数
async function reportProgress(jobId: string, stage: ProgressStage, message: string, progress: number, extra?: Record<string, any>) {
  const data = { stage, message, progress, ...extra };
  await redis.set(`progress:${jobId}`, JSON.stringify(data), { ex: 600 });
}

// 带自动推进的长耗时操作包装器
// 在执行 fn 的同时，每隔 intervalMs 向 Redis 写入递增的进度
async function withAutoProgress<T>(
  jobId: string,
  stage: ProgressStage,
  message: string,
  startProgress: number,
  endProgress: number,
  fn: () => Promise<T>,
  intervalMs: number = 2000,
): Promise<T> {
  // 先写入起始进度
  await reportProgress(jobId, stage, message, startProgress);

  let resolved = false;
  let result: T;
  let err: any;

  // 同时启动：实际任务 + 定时进度推进
  const taskPromise = fn().then(r => { resolved = true; return r; }).catch(e => { resolved = true; throw e; });

  // 定时推进：每 2 秒往目标靠近一点
  const totalRange = endProgress - startProgress;
  let current = startProgress;
  const progressTimer = setInterval(async () => {
    if (resolved) return;
    current += totalRange * (intervalMs / 30000); // 假设该阶段最多30秒，按比例分配
    if (current >= endProgress - 2) current = endProgress - 2; // 不超过终点-2，留给最终确认
    try {
      await reportProgress(jobId, stage, message, Math.round(current));
    } catch { /* ignore */ }
  }, intervalMs);

  try {
    result = await taskPromise;
  } catch (e) {
    err = e;
  } finally {
    clearInterval(progressTimer);
  }

  if (err) throw err;
  return result!;
}

type ProgressStage = 'upload' | 'downloading' | 'transcribing' | 'analyzing' | 'saving' | 'done' | 'error';

export async function POST(request: Request) {
  const jobId = crypto.randomUUID().slice(0, 8);

  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
    }

    // 报告：开始下载
    await reportProgress(jobId, 'downloading', 'Downloading audio file...', 5);

    // 1. Fetch file from Vercel Blob (带自动推进)
    let blobRes: Response;
    let blobBuffer: ArrayBuffer;
    try {
      blobRes = await withAutoProgress(jobId, 'downloading', 'Downloading audio file from storage...', 5, 15, async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        return res;
      });
      blobBuffer = await blobRes.arrayBuffer();
    } catch (fetchErr: unknown) {
      const fetchMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      await reportProgress(jobId, 'error', 'Failed to download audio file', 0, { error: fetchMsg || 'Failed to fetch file from storage' });
      return NextResponse.json({ error: 'Failed to fetch file from storage', jobId }, { status: 500 });
    }

    const buffer = Buffer.from(blobBuffer);
    const MAX_SIZE = 50 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      await reportProgress(jobId, 'error', 'File too large', 0, { error: 'File too large. Max 50MB allowed.' });
      return NextResponse.json({ error: 'File too large. Max 50MB allowed.', jobId }, { status: 400 });
    }

    const filename = url.split('/').pop()?.split('?')[0] || 'audio.mp3';
    const mimeType = blobRes.headers.get('content-type') || 'audio/mpeg';

    const cleanKey = (process.env.OPENAI_API_KEY || '').replace(/[\uFEFF\u200B]/g, '');

    // 2. Call Whisper for transcription (带自动推进 — 最耗时的步骤)
    let whisperData: any;
    try {
      whisperData = await withAutoProgress(jobId, 'transcribing', 'Transcribing audio with AI...', 15, 55, async () => {
        const boundary = '----FormBoundary' + crypto.randomUUID().replace(/-/g, '');
        const headerPart = '--' + boundary + '\r\n'
          + 'Content-Disposition: form-data; name="file"; filename="audio.mp3"\r\n'
          + 'Content-Type: ' + mimeType + '\r\n\r\n';
        const modelPart = '\r\n--' + boundary + '\r\n'
          + 'Content-Disposition: form-data; name="model"\r\n\r\n'
          + 'whisper-1\r\n'
          + '--' + boundary + '--\r\n';

        const encoder = new TextEncoder();
        const headerBuf = encoder.encode(headerPart);
        const footerBuf = encoder.encode(modelPart);
        const audioBytes = new Uint8Array(blobBuffer);
        const allBytes = new Uint8Array(headerBuf.byteLength + audioBytes.byteLength + footerBuf.byteLength);
        allBytes.set(headerBuf, 0);
        allBytes.set(audioBytes, headerBuf.byteLength);
        allBytes.set(footerBuf, headerBuf.byteLength + audioBytes.byteLength);

        const whisperRes = await fetch('https://api.302.ai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + cleanKey,
            'Content-Type': 'multipart/form-data; boundary=' + boundary,
          },
          body: allBytes.buffer,
        });

        if (!whisperRes.ok) {
          const errText = await whisperRes.text();
          throw new Error(`Whisper API error: ${errText}`);
        }

        return await whisperRes.json();
      });
    } catch (whisperErr: unknown) {
      const whisperMsg = whisperErr instanceof Error ? whisperErr.message : String(whisperErr);
      await reportProgress(jobId, 'error', 'Transcription failed', 40, { error: whisperMsg || 'Whisper transcription failed' });
      return NextResponse.json({ error: whisperMsg || 'Whisper transcription failed', jobId }, { status: 500 });
    }

    const rawTranscript = whisperData.text as string;
    const transcript = cleanText(rawTranscript);

    if (!transcript || transcript.trim().length < 10) {
      await reportProgress(jobId, 'error', 'Audio too short or unclear', 55, { error: 'Transcription failed or audio was too short.' });
      return NextResponse.json({ error: 'Transcription failed or audio was too short.', jobId }, { status: 500 });
    }

    // 3. Call GPT for structured minutes (带自动推进)
    let gptData: any;
    try {
      gptData = await withAutoProgress(jobId, 'analyzing', 'AI is analyzing and structuring your meeting notes...', 55, 85, async () => {
        const prompt = `You are a professional meeting minute writer. Analyze the transcript below.

Return a JSON object with EXACTLY this structure (no markdown, no code blocks, just raw JSON):
{
  "summary": "A concise summary in 80-100 words, in the SAME LANGUAGE as the transcript",
  "decisions": ["Decision 1", "Decision 2"],
  "actionItems": [
    {"task": "Description of task", "owner": "Person name or Unassigned", "deadline": "Date or Not specified"}
  ]
}

Rules:
- Extract ALL action items, even implicit ones
- Be specific about what needs to be done
- Include the person responsible if mentioned
- summary should cover main topics and meeting purpose
- Respond in the same language as the transcript (Chinese if transcript is in Chinese)

---
Transcript:
${transcript}`;

        const gptRes = await fetch('https://api.302.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + cleanKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
            response_format: { type: 'json_object' },
          }),
        });

        if (!gptRes.ok) {
          const errText = await gptRes.text();
          throw new Error(`GPT API error: ${errText}`);
        }

        return await gptRes.json();
      });
    } catch (gptErr: unknown) {
      const gptMsg = gptErr instanceof Error ? gptErr.message : String(gptErr);
      await reportProgress(jobId, 'error', 'AI analysis failed', 70, { error: gptMsg || 'GPT analysis failed' });
      return NextResponse.json({ error: gptMsg || 'GPT analysis failed', jobId }, { status: 500 });
    }

    const rawContent = gptData.choices[0].message.content;

    // Parse GPT response
    let parsed: any;
    try {
      const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // GPT 返回非 JSON → 降级处理
      await reportProgress(jobId, 'saving', 'Saving meeting data...', 90);
      const fallbackId = crypto.randomUUID().slice(0, 8);
      await redis.set(`meeting:${fallbackId}`, JSON.stringify({
        id: fallbackId,
        summary: '',
        decisions: [],
        actionItems: [],
        transcript,
        createdAt: Date.now(),
      }), { ex: 30 * 24 * 60 * 60 });

      const result = {
        transcript,
        result: rawContent,
        shareUrl: null,
        shareId: null,
        jobId,
      };
      await reportProgress(jobId, 'done', 'Done!', 100, { result });
      return NextResponse.json(result);
    }

    // 报告：保存数据
    await reportProgress(jobId, 'saving', 'Saving your meeting minutes...', 90);

    // 4. Store in Redis
    const id = crypto.randomUUID().slice(0, 8);
    const meetingData: MeetingData = {
      id,
      summary: parsed.summary || '',
      decisions: parsed.decisions || [],
      actionItems: (parsed.actionItems || []).map((item: any, idx: number) => ({
        id: `action-${idx}`,
        task: item.task || '',
        owner: item.owner || 'Unassigned',
        completed: false,
      })),
      transcript,
      createdAt: Date.now(),
    };

    await redis.set(`meeting:${id}`, JSON.stringify(meetingData), { ex: 30 * 24 * 60 * 60 });

    const resultText = `## Summary\n${meetingData.summary}\n\n## Key Decisions\n${meetingData.decisions.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\n## Action Items\n${meetingData.actionItems.map(a => `• ${a.task} | Owner: ${a.owner} | Status: ${a.completed ? '✅ Done' : '⏳ Pending'}`).join('\n')}`;

    const result = {
      transcript,
      result: resultText,
      summary: meetingData.summary,
      decisions: meetingData.decisions,
      shareId: id,
      actionItems: meetingData.actionItems,
      shareUrl: `/minutes/${id}`,
      jobId,
    };

    // 完成！
    await reportProgress(jobId, 'done', 'Meeting minutes ready! 🎉', 100, { result });

    return NextResponse.json(result);

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await reportProgress(jobId, 'error', 'An unexpected error occurred', 0, { error: message });
    return NextResponse.json({ error: message, jobId }, { status: 500 });
  }
}
