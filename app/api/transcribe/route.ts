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
  await redis.set(`progress:${jobId}`, JSON.stringify(data), { ex: 600 }); // 10分钟过期
}

type ProgressStage = 'upload' | 'downloading' | 'transcribing' | 'analyzing' | 'saving' | 'done' | 'error';

export async function POST(request: Request) {
  // 生成 jobId 用于进度追踪
  const jobId = crypto.randomUUID().slice(0, 8);

  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
    }

    // 报告：开始下载
    await reportProgress(jobId, 'downloading', 'Downloading audio file from storage...', 10);

    // 1. Fetch file from Vercel Blob
    const blobRes = await fetch(url);
    if (!blobRes.ok) {
      await reportProgress(jobId, 'error', 'Failed to download audio file', 0, { error: 'Failed to fetch file from storage' });
      return NextResponse.json({ error: 'Failed to fetch file from storage', jobId }, { status: 500 });
    }

    const blobBuffer = await blobRes.arrayBuffer();
    const buffer = Buffer.from(blobBuffer);

    // Check file size (50MB max for Blob)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (buffer.length > MAX_SIZE) {
      await reportProgress(jobId, 'error', 'File too large', 0, { error: 'File too large. Max 50MB allowed.' });
      return NextResponse.json({ error: 'File too large. Max 50MB allowed.', jobId }, { status: 400 });
    }

    // Get filename from URL
    const filename = url.split('/').pop()?.split('?')[0] || 'audio.mp3';
    const mimeType = blobRes.headers.get('content-type') || 'audio/mpeg';

    // ⚠️ 关键：清理 API Key 中可能存在的 BOM 字符
    const cleanKey = (process.env.OPENAI_API_KEY || '').replace(/[\uFEFF\u200B]/g, '');

    // 报告：开始转录（这是最耗时的步骤）
    await reportProgress(jobId, 'transcribing', 'Transcribing audio with AI (this may take a moment)...', 25);

    // 2. Call 302AI Whisper for transcription
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
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
      await reportProgress(jobId, 'error', 'Transcription failed', 40, { error: `Whisper error: ${errText}` });
      return NextResponse.json({ error: `Whisper error: ${errText}`, jobId }, { status: 500 });
    }

    const whisperData = await whisperRes.json();
    const rawTranscript = whisperData.text as string;
    const transcript = cleanText(rawTranscript);

    if (!transcript || transcript.trim().length < 10) {
      await reportProgress(jobId, 'error', 'Audio too short or unclear', 50, { error: 'Transcription failed or audio was too short.' });
      return NextResponse.json({ error: 'Transcription failed or audio was too short.', jobId }, { status: 500 });
    }

    // 报告：转录完成，开始 AI 分析
    await reportProgress(jobId, 'analyzing', 'AI is analyzing and structuring your meeting notes...', 60);

    // 3. Call GPT for structured minutes + action items
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
      await reportProgress(jobId, 'error', 'AI analysis failed', 70, { error: `GPT error: ${errText}` });
      return NextResponse.json({ error: `GPT error: ${errText}`, jobId }, { status: 500 });
    }

    const gptData = await gptRes.json();
    const rawContent = gptData.choices[0].message.content;

    // Parse GPT response
    let parsed: any;
    try {
      const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      await reportProgress(jobId, 'saving', 'Saving meeting data...', 85);
      // GPT 返回了非 JSON，返回原始内容
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

    // 4. Generate unique ID and store in Redis
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

    // 报告：完成！
    await reportProgress(jobId, 'done', 'Meeting minutes ready! 🎉', 100, { result });

    return NextResponse.json(result);

  } catch (error: any) {
    await reportProgress(jobId, 'error', 'An unexpected error occurred', 0, { error: error.message || 'Unknown error' });
    return NextResponse.json({ error: error.message || 'Unknown error', jobId }, { status: 500 });
  }
}
