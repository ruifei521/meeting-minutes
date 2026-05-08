import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

// 进度数据结构
interface ProgressData {
  stage: 'upload' | 'downloading' | 'transcribing' | 'analyzing' | 'saving' | 'done' | 'error';
  message: string;
  progress: number; // 0-100
  result?: any;      // 完成后的结果数据
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

  // SSE 响应流
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 发送初始连接确认
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      let lastStage = '';
      let attempts = 0;
      const maxAttempts = 300; // 最多轮询 5 分钟（每秒一次）

      // 轮询 Redis 获取进度
      while (attempts < maxAttempts) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 1000)); // 每秒查询一次

        try {
          const raw = await redis.get(`progress:${jobId}`);

          if (!raw) {
            // 还没有进度数据，继续等待
            if (attempts % 10 === 0) {
              // 每10秒发一个心跳，防止连接超时
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', attempts })}\n\n`));
            }
            continue;
          }

          const progress: ProgressData = typeof raw === 'string' ? JSON.parse(raw) : raw;

          // 只在阶段变化或完成时推送
          if (progress.stage !== lastStage || progress.stage === 'done' || progress.stage === 'error') {
            lastStage = progress.stage;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));

            if (progress.stage === 'done' || progress.stage === 'error') {
              // 完成或出错，关闭流
              controller.close();
              return;
            }
          } else {
            // 同阶段时也定期推送更新（带当前百分比）
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
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

      // 超时
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
