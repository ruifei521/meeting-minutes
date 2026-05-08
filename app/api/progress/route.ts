import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

interface ProgressData {
  stage: string;
  message: string;
  progress: number;
  result?: any;
  error?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'Missing jobId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const signal = request.signal;

  // SSE 响应流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 发送初始连接确认
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      let attempts = 0;
      const maxAttempts = 600; // 最多 5 分钟（每 500ms 一次）

      while (attempts < maxAttempts && !signal.aborted) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 500)); // 每 500ms 查询一次（更快响应）

        try {
          const raw = await redis.get(`progress:${jobId}`);

          if (!raw) {
            if (attempts % 20 === 0) { // 每 10 秒发心跳
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', attempts })}\n\n`));
            }
            continue;
          }

          const progress: ProgressData = typeof raw === 'string' ? JSON.parse(raw) : raw;

          // 始终推送最新进度（不再只推送阶段变化）
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));

          if (progress.stage === 'done' || progress.stage === 'error') {
            controller.close();
            return;
          }
        } catch (err) {
          console.error('Progress poll error:', err);
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ stage: 'error', message: 'Progress tracking error', progress: 0, error: String(err) })}\n\n`
          ));
          controller.close();
          return;
        }
      }

      // 超时或客户端断连
      if (signal.aborted) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ stage: 'error', message: 'Processing timeout - please try again', progress: 0, error: 'timeout' })}\n\n`
      ));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
