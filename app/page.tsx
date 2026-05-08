'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { upload } from '@vercel/blob/client';

interface ActionItem {
  id: string;
  task: string;
  owner: string;
  completed: boolean;
}

// 进度阶段配置
const STAGES: Record<string, { icon: string; color: string; label: string }> = {
  uploading:    { icon: '📤', color: 'text-blue-400',   label: 'Uploading' },
  downloading:  { icon: '⬇️', color: 'text-blue-300',   label: 'Downloading' },
  transcribing: { icon: '🎧', color: 'text-purple-400', label: 'Transcribing' },
  analyzing:    { icon: '🧠', color: 'text-yellow-400', label: 'AI Analyzing' },
  saving:       { icon: '💾', color: 'text-green-400',  label: 'Saving' },
  done:         { icon: '✅', color: 'text-green-400',  label: 'Done!' },
  error:        { icon: '❌', color: 'text-red-400',    label: 'Error' },
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<string[]>([]);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 实时进度状态
  const [progressStage, setProgressStage] = useState<string>('');
  const [progressMessage, setProgressMessage] = useState<string>('');
  const [serverProgress, setServerProgress] = useState<number>(0); // 服务端报告的进度
  const [displayProgress, setDisplayProgress] = useState<number>(0); // 实际显示的进度（含动画插值）
  const currentJobIdRef = useRef<string | null>(null);       // 当前 job ID
  const esRef = useRef<EventSource | null>(null);            // SSE 连接引用
  const animFrameRef = useRef<number | null>(null);          // 动画帧引用

  // ========== 平滑进度动画 ==========
  // 原理：displayProgress 持续追赶 serverProgress，形成丝滑的流动感
  useEffect(() => {
    if (!loading) {
      setDisplayProgress(0);
      return;
    }

    const animate = () => {
      setDisplayProgress(prev => {
        const target = serverProgress;
        const diff = target - prev;

        // 已完成或出错 → 直接跳到目标值
        if (target === 100 || progressStage === 'error' || progressStage === 'done') {
          return target;
        }

        // 差距很小 → 直接跟上（防止抖动）
        if (Math.abs(diff) < 1) {
          return target;
        }

        // 平滑追赶：差距越大追得越快，但不超过 2%/帧
        // 这创造了"持续前进"的感觉
        const speed = Math.max(0.3, Math.min(Math.abs(diff) * 0.08, 2));
        return prev + (diff > 0 ? speed : -speed);
      });

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [loading, serverProgress, progressStage]);

  // ========== SSE 连接管理 ==========
  useEffect(() => {
    return () => {
      // 组件卸载时关闭 SSE（防内存泄漏）
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);

  // ========== 提交处理 ==========
  const handleSubmit = async () => {
    if (!file) return;

    // 清理旧的 SSE 连接
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setTranscript(null);
    setShareUrl(null);
    setMeetingId(null);
    setSummary(null);
    setDecisions([]);
    setActionItems([]);

    // 初始化进度状态
    setProgressStage('uploading');
    setProgressMessage('Uploading audio file...');
    setServerProgress(3);
    setDisplayProgress(3);

    try {
      // Step 1: 客户端直传 Vercel Blob
      const ext = (file.name.split('.').pop() || 'mp3').replace(/[^a-zA-Z0-9]/g, '');
      const randomName = `meeting-${Date.now()}.${ext}`;
      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'audio/mpeg' });
      const uploadResult = await upload(randomName, blob, {
        access: 'public',
        handleUploadUrl: '/api/upload',
      });
      const blobUrl = uploadResult.url;

      setServerProgress(8);
      setProgressMessage('Starting AI processing...');

      // Step 2: 调用转录 API（返回 jobId）
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: blobUrl }),
      });

      const rawText = await res.text();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        setError(`Server returned non-JSON (status ${res.status}): ${rawText.slice(0, 200)}`);
        setLoading(false);
        return;
      }

      if (!res.ok && !data.jobId) {
        setError(data?.error || `Server error (${res.status})`);
        setLoading(false);
        return;
      }

      // Step 3: 建立 SSE 连接监听实时进度
      if (data.jobId) {
        currentJobIdRef.current = data.jobId;
        connectSSE(data.jobId);
      }

      // 兜底：如果服务端已经返回了结果（没有走异步模式）
      if (data.result && !data.jobId) {
        finishWithResult(data);
      }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setLoading(false);
    }
  };

  // ========== SSE 连接函数 ==========
  const connectSSE = useCallback((jobId: string) => {
    // 先关闭旧连接
    if (esRef.current) esRef.current.close();

    const es = new EventSource(`/api/progress?jobId=${jobId}`);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') return;
        if (data.type === 'heartbeat') return;

        if (data.stage) {
          setProgressStage(data.stage);
          setProgressMessage(data.message || '');

          // 关键：只更新 serverProgress，displayProgress 由 animation loop 自动平滑追赶
          if (typeof data.progress === 'number') {
            setServerProgress(data.progress);
          }

          // 完成阶段 → 填充结果
          if (data.stage === 'done' && data.result) {
            es.close();
            esRef.current = null;
            finishWithResult(data.result);
          }

          // 错误阶段
          if (data.stage === 'error') {
            es.close();
            esRef.current = null;
            setError(data.error || data.message || 'Processing failed');
            setLoading(false);
          }
        }
      } catch {
        console.warn('Failed to parse SSE message:', event.data);
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;
      // 如果还在 loading 且没完成/没报错，不主动中断——可能是网络抖动
      // displayProgress 的动画会继续运行，给用户"仍在处理中"的感觉
    };
  }, []);

  // ========== 结果填充 ==========
  const finishWithResult = (data: any) => {
    setResult(data.result);
    setTranscript(data.transcript);
    setSummary(data.summary || null);
    setDecisions(data.decisions || []);
    setMeetingId(data.shareId || null);
    if (data.shareUrl) {
      setShareUrl(`${window.location.origin}${data.shareUrl}`);
    }
    if (data.actionItems) {
      setActionItems(data.actionItems);
    }
    setLoading(false);
    setProgressStage('done');
    setProgressMessage('Done!');
    setServerProgress(100);
  };

  // ========== 取消处理 ==========
  const handleCancel = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setLoading(false);
    setError('Processing cancelled by user');
    setProgressStage('');
  };

  // ========== 复制操作 ==========
  const copyResult = async () => {
    try {
      if (result) await navigator.clipboard.writeText(result);
    } catch {
      /* clipboard not available */
    }
  };

  const copyShareLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  // ========== 行动事项切换 ==========
  const toggleAction = async (actionId: string) => {
    if (!meetingId) return;
    const prevCompleted = actionItems.find(a => a.id === actionId)?.completed ?? false;
    // 乐观更新
    setActionItems(prev => prev.map(item =>
      item.id === actionId ? { ...item, completed: !item.completed } : item
    ));
    try {
      const res = await fetch('/api/toggle-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, actionId }),
      });
      if (!res.ok) {
        // 回滚乐观更新
        setActionItems(prev => prev.map(item =>
          item.id === actionId ? { ...item, completed: prevCompleted } : item
        ));
      }
    } catch {
      // 回滚乐观更新
      setActionItems(prev => prev.map(item =>
        item.id === actionId ? { ...item, completed: prevCompleted } : item
      ));
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const currentStageConfig = STAGES[progressStage] || { icon: '⏳', color: 'text-slate-400', label: 'Processing' };
  const showPercent = Math.round(Math.min(displayProgress, 99.9));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="max-w-3xl mx-auto px-4 py-16">
        {/* 标题 */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Meeting Minutes AI
          </h1>
          <p className="text-slate-400">Upload your meeting audio, get structured minutes + action items</p>
        </div>

        {/* 上传区域 */}
        {!loading && (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
            }}
            className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
              dragOver ? 'border-blue-400 bg-blue-400/10' : 'border-slate-600 hover:border-slate-400'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
              className="hidden"
            />
            <div className="text-5xl mb-4">🎙️</div>
            <p className="text-slate-300 mb-2">Drop audio file here or click to upload</p>
            <p className="text-sm text-slate-500">MP3, WAV, M4A, WebM, OGG • Max 50MB</p>
          </div>
        )}

        {/* 文件信息 + 提交按钮 */}
        {file && !loading && (
          <div className="mt-6 p-4 bg-slate-700/50 rounded-lg flex items-center justify-between">
            <div>
              <p className="font-medium">{file.name}</p>
              <p className="text-sm text-slate-400">{formatFileSize(file.size)}</p>
            </div>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-600 rounded-lg font-medium transition-colors"
            >
              Generate Minutes ✨
            </button>
          </div>
        )}

        {/* ====== 实时进度展示 ====== */}
        {loading && (
          <div className="mt-8 p-8 bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-700 shadow-xl animate-fade-in">
            {/* 标题栏 + 取消按钮 */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <span className="text-3xl animate-bounce">{currentStageConfig.icon}</span>
                <div>
                  <h3 className={`text-lg font-semibold ${currentStageConfig.color}`}>
                    {progressMessage || 'Processing...'}
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Stage: {currentStageConfig.label}
                  </p>
                </div>
              </div>

              {/* 取消按钮 */}
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-red-900/50 hover:text-red-300 rounded-lg border border-slate-600 hover:border-red-800 transition-colors"
              >
                ✕ Cancel
              </button>
            </div>

            {/* 进度条 — 使用 displayProgress 实现平滑动画 */}
            <div className="relative mb-6">
              <div className="h-5 bg-slate-700 rounded-full overflow-hidden shadow-inner">
                <div
                  className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                    progressStage === 'error'
                      ? 'bg-red-500'
                      : progressStage === 'done'
                        ? 'bg-green-500'
                        : 'bg-gradient-to-r from-blue-500 via-purple-500 to-cyan-500 bg-[length:200%_100%] animate-gradient-flow'
                  }`}
                  style={{ width: `${showPercent}%` }}
                />
              </div>
              {/* 百分比标签 */}
              <span className={`absolute right-0 -top-7 text-sm font-mono font-bold tabular-nums ${
                progressStage === 'error' ? 'text-red-400' :
                progressStage === 'done' ? 'text-green-400' :
                showPercent > 50 ? 'text-green-400' : 'text-blue-400'
              }`}>
                {showPercent}%
              </span>
              {/* 进度条内嵌百分比（大数字） */}
              {showPercent > 10 && (
                <span className={`absolute left-1/2 -translate-x-1/2 top-0 text-xs font-bold pointer-events-none select-none tabular-nums ${
                  showPercent > 80 ? 'text-white' : 'text-white/70'
                }`}>
                  {showPercent}%
                </span>
              )}
            </div>

            {/* 阶段步骤指示器 */}
            <div className="flex items-center justify-between mb-4 px-1">
              {[
                { key: 'downloading', num: 1 },
                { key: 'transcribing', num: 2 },
                { key: 'analyzing', num: 3 },
                { key: 'saving', num: 4 },
                { key: 'done', num: 5 },
              ].map((step) => {
                const stageOrder = ['uploading', 'downloading', 'transcribing', 'analyzing', 'saving', 'done'];
                const currentIdx = stageOrder.indexOf(progressStage);
                const stepIdx = stageOrder.indexOf(step.key);
                const isCompleted = stepIdx < currentIdx || progressStage === 'done';
                const isCurrent = step.key === progressStage ||
                  (step.key === 'done' && progressStage === 'done');

                return (
                  <div key={step.key} className="flex flex-col items-center flex-1">
                    <div className={`
                      w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-500
                      ${isCompleted
                        ? 'bg-green-500/20 text-green-400 border-2 border-green-500/40'
                        : isCurrent
                          ? 'bg-blue-500/20 text-blue-400 border-2 border-blue-500/60 ring-2 ring-blue-500/20 scale-110'
                          : 'bg-slate-700/50 text-slate-500 border-2 border-slate-600'}
                    `}>
                      {isCompleted ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      ) : (
                        step.num
                      )}
                    </div>
                    <span className={`text-[10px] mt-1.5 hidden sm:block font-medium transition-colors duration-300 ${
                      isCompleted ? 'text-green-400' : isCurrent ? 'text-blue-400' : 'text-slate-600'
                    }`}>
                      {STAGES[step.key]?.label || step.key}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 连接线（步骤之间的横线） */}
            <div className="flex items-center px-7 -mt-8 mb-6">
              {[0, 1, 2, 3].map(i => {
                const stageOrder = ['uploading', 'downloading', 'transcribing', 'analyzing', 'saving', 'done'];
                const currentIdx = stageOrder.indexOf(progressStage);
                const stepIdx = i; // 对应 downloading=0, transcribing=1, ...
                const isActive = stepIdx < currentIdx || progressStage === 'done';
                return (
                  <div key={i} className={`flex-1 h-[2px] rounded-full mx-0.5 transition-colors duration-500 ${isActive ? 'bg-green-500/40' : 'bg-slate-700'}`} />
                );
              })}
            </div>

            {/* 阶段描述文字 */}
            <div className="mt-2 pt-4 border-t border-slate-700/60">
              {progressStage === 'downloading' && (
                <p className="text-sm text-slate-400 flex items-center gap-2">
                  ⬇️ Retrieving your audio file from secure cloud storage...
                </p>
              )}
              {progressStage === 'transcribing' && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-400 flex items-center gap-2">
                    🎧 Converting speech to text using Whisper AI...
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    This is the longest step — longer audio files take more time. The progress bar will continue moving as the AI works.
                  </p>
                </div>
              )}
              {progressStage === 'analyzing' && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-400 flex items-center gap-2">
                    🧠 GPT is extracting summary, decisions &amp; action items...
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Almost there! The AI is organizing your meeting notes into a structured format.
                  </p>
                </div>
              )}
              {progressStage === 'saving' && (
                <p className="text-sm text-slate-400 flex items-center gap-2">
                  💾 Saving your meeting minutes and generating share link...
                </p>
              )}
              {progressStage === 'done' && (
                <p className="text-sm text-green-400 flex items-center gap-2 font-medium">
                  🎉 All done! Your meeting minutes are ready below.
                </p>
              )}
              {progressStage === 'error' && (
                <p className="text-sm text-red-400 flex items-center gap-2">
                  ❌ Something went wrong. Please see the error above and try again.
                </p>
              )}
              {!['downloading','transcribing','analyzing','saving','done','error'].includes(progressStage) && (
                <p className="text-sm text-slate-500 animate-pulse flex items-center gap-2">
                  ⏳ Initializing processing pipeline...
                </p>
              )}
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && !loading && (
          <div className="mt-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300">
            <div className="flex items-start gap-2">
              <span>⚠️</span>
              <div className="flex-1">{error}</div>
              <button
                onClick={() => { setError(null); setProgressStage(''); }}
                className="underline text-sm hover:text-red-200 shrink-0"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {/* ====== 结果展示区 ====== */}
        {result && !loading && (
          <div className="mt-8 space-y-6 animate-fade-in">
            {shareUrl && (
              <div className="p-4 bg-green-900/30 border border-green-700 rounded-lg">
                <p className="text-green-300 text-sm mb-2">✅ Share link generated:</p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    className="flex-1 bg-slate-800 px-3 py-2 rounded text-sm text-slate-300"
                  />
                  <button
                    onClick={copyShareLink}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm font-medium"
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {actionItems.length > 0 && (
              <div className="p-6 bg-slate-800/70 rounded-xl border border-slate-700">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  ✅ Action Items
                  <span className="text-sm font-normal text-slate-500">
                    ({actionItems.filter(a => a.completed).length}/{actionItems.length} done)
                  </span>
                </h3>
                <ul className="space-y-3">
                  {actionItems.map((action) => (
                    <li
                      key={action.id}
                      onClick={() => toggleAction(action.id)}
                      className={`p-4 rounded-lg border cursor-pointer transition-all ${
                        action.completed
                          ? 'bg-green-500/10 border-green-500/30'
                          : 'bg-slate-700/50 border-slate-600 hover:border-slate-500'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                          action.completed
                            ? 'bg-green-500 border-green-500'
                            : 'border-slate-500'
                        }`}>
                          {action.completed && <span className="text-xs">✓</span>}
                        </div>
                        <div className="flex-1">
                          <p className={`font-medium ${action.completed ? 'line-through text-slate-500' : 'text-white'}`}>
                            {action.task}
                          </p>
                          <p className="text-sm text-slate-500 mt-1">
                            👤 {action.owner}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {summary && (
              <div className="p-6 bg-slate-800/70 rounded-xl border border-slate-700">
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  📝 Summary
                </h3>
                <p className="text-slate-300 leading-relaxed">{summary}</p>
              </div>
            )}

            {decisions.length > 0 && (
              <div className="p-6 bg-slate-800/70 rounded-xl border border-slate-700">
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  🎯 Key Decisions
                </h3>
                <ul className="space-y-2">
                  {decisions.map((decision, idx) => (
                    <li key={idx} className="text-slate-300 flex items-start gap-2">
                      <span className="text-blue-400 mt-1 shrink-0">•</span>
                      {decision}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="p-4 bg-slate-700/50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-lg">📋 Full Text</h3>
                <button
                  onClick={copyResult}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-sm"
                >
                  Copy All
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-slate-400 text-sm font-mono max-h-96 overflow-y-auto">{result}</pre>
            </div>

            {transcript && (
              <details className="p-4 bg-slate-700/50 rounded-lg">
                <summary className="cursor-pointer font-medium text-slate-400 hover:text-slate-300">
                  📜 View Full Transcript
                </summary>
                <p className="mt-4 text-sm text-slate-400 whitespace-pre-wrap">{transcript}</p>
              </details>
            )}
          </div>
        )}

        <p className="text-center text-slate-500 text-sm mt-12">Powered by AI</p>
      </div>

      {/* 全局动画样式 */}
      <style jsx global>{`
        @keyframes gradient-flow {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient-flow {
          animation: gradient-flow 2s ease infinite;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
