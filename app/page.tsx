'use client';

import { useState, useRef, useCallback } from 'react';
import { upload } from '@vercel/blob/client';

interface ActionItem {
  id: string;
  task: string;
  owner: string;
  completed: boolean;
}

// 进度阶段配置
const STAGES: Record<string, { icon: string; color: string }> = {
  uploading:    { icon: '📤', color: 'text-blue-400' },
  downloading:  { icon: '⬇️', color: 'text-blue-300' },
  transcribing: { icon: '🎧', color: 'text-purple-400' },
  analyzing:    { icon: '🧠', color: 'text-yellow-400' },
  saving:       { icon: '💾', color: 'text-green-400' },
  done:         { icon: '✅', color: 'text-green-400' },
  error:        { icon: '❌', color: 'text-red-400' },
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
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  // SSE 连接函数
  const connectProgress = useCallback((jobId: string) => {
    const controller = new AbortController();
    abortRef.current = controller;

    const eventSource = new EventSource(`/api/progress?jobId=${jobId}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') return;
        if (data.type === 'heartbeat') return;

        // 收到进度更新
        if (data.stage) {
          setProgressStage(data.stage);
          setProgressMessage(data.message || '');
          setProgressPercent(data.progress || 0);

          if (data.stage === 'done' && data.result) {
            eventSource.close();
            // 填充结果数据
            const r = data.result;
            setResult(r.result);
            setTranscript(r.transcript);
            setSummary(r.summary || null);
            setDecisions(r.decisions || []);
            setMeetingId(r.shareId || null);
            if (r.shareUrl) {
              setShareUrl(`${window.location.origin}${r.shareUrl}`);
            }
            if (r.actionItems) {
              setActionItems(r.actionItems);
            }
            setLoading(false);
          }

          if (data.stage === 'error') {
            eventSource.close();
            setError(data.error || data.message || 'Processing failed');
            setLoading(false);
          }
        }
      } catch {
        // 忽略非 JSON 消息（如心跳）
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      // SSE 断开不一定是错误，可能已完成
      if (loading && progressStage !== 'done' && progressStage !== 'error') {
        // 如果还在 loading 且没完成，可能是断连，给个提示但不中断
        console.warn('SSE connection lost, result may still be available via API response');
      }
    };

    // 清理函数
    return () => {
      eventSource.close();
    };
  }, [loading, progressStage]);

  const handleSubmit = async () => {
    if (!file) return;
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
    setProgressPercent(5);

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

      // Step 3: 连接 SSE 获取实时进度
      if (data.jobId) {
        connectProgress(data.jobId);
      }

      // 兜底：如果 SSE 没触发 done，检查是否有直接结果
      if (data.result && !data.jobId) {
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
        setProgressPercent(100);
      }

    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const copyResult = () => {
    if (result) navigator.clipboard.writeText(result);
  };

  const copyShareLink = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const toggleAction = async (actionId: string) => {
    if (!meetingId) return;
    setActionItems(prev => prev.map(item =>
      item.id === actionId ? { ...item, completed: !item.completed } : item
    ));
    try {
      await fetch('/api/toggle-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, actionId }),
      });
    } catch {}
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const currentStageConfig = STAGES[progressStage] || { icon: '⏳', color: 'text-slate-400' };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      <div className="max-w-3xl mx-auto px-4 py-16">
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
          <div className="mt-8 p-8 bg-slate-800/80 backdrop-blur rounded-2xl border border-slate-700 shadow-xl">
            {/* 顶部标题栏 */}
            <div className="flex items-center gap-3 mb-6">
              <span className="text-3xl animate-bounce">{currentStageConfig.icon}</span>
              <div>
                <h3 className={`text-lg font-semibold ${currentStageConfig.color}`}>
                  {progressMessage || 'Processing...'}
                </h3>
                <p className="text-sm text-slate-500 mt-0.5">
                  Please wait, this usually takes 15-45 seconds depending on audio length
                </p>
              </div>
            </div>

            {/* 进度条 */}
            <div className="relative mb-6">
              <div className="h-4 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${
                    progressStage === 'error'
                      ? 'bg-red-500'
                      : progressStage === 'done'
                        ? 'bg-green-500'
                        : 'bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 bg-[length:200%_100%] animate-gradient-shift'
                  }`}
                  style={{
                    width: `${Math.min(progressPercent, 100)}%`,
                  }}
                />
              </div>
              {/* 百分比标签 */}
              <span className={`absolute right-0 -top-6 text-sm font-mono font-bold ${
                progressStage === 'error' ? 'text-red-400' : progressStage === 'done' ? 'text-green-400' : 'text-blue-400'
              }`}>
                {progressPercent}%
              </span>
            </div>

            {/* 阶段步骤指示器 */}
            <div className="flex items-center justify-between mb-2">
              {[
                { key: 'downloading', label: 'Download' },
                { key: 'transcribing', label: 'Transcribe' },
                { key: 'analyzing', label: 'AI Analyze' },
                { key: 'saving', label: 'Save' },
                { key: 'done', label: 'Done!' },
              ].map((step, idx) => {
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
                      ${isCompleted ? 'bg-green-500/20 text-green-400 border border-green-500/50' :
                        isCurrent ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50 ring-2 ring-blue-500/30' :
                        'bg-slate-700 text-slate-500 border border-slate-600'}
                    `}>
                      {isCompleted ? '✓' : idx + 1}
                    </div>
                    <span className={`text-[10px] mt-1.5 hidden sm:block ${
                      isCompleted ? 'text-green-400' : isCurrent ? 'text-blue-400' : 'text-slate-600'
                    }`}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* 阶段描述文字 */}
            <div className="mt-5 pt-4 border-t border-slate-700">
              {progressStage === 'downloading' && (
                <p className="text-sm text-slate-400 flex items-center gap-2">
                  ⬇️ Retrieving your audio file from secure storage...
                </p>
              )}
              {progressStage === 'transcribing' && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-400 flex items-center gap-2">
                    🎧 Converting speech to text using Whisper AI...
                  </p>
                  <p className="text-xs text-slate-600">
                    This is the longest step — longer audio files take more time. Typically 10-30 seconds.
                  </p>
                </div>
              )}
              {progressStage === 'analyzing' && (
                <div className="space-y-2">
                  <p className="text-sm text-slate-400 flex items-center gap-2">
                    🧠 GPT is extracting summary, decisions &amp; action items...
                  </p>
                  <p className="text-xs text-slate-600">
                    Almost there! The AI is organizing your meeting into a structured format.
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
                  ❌ Something went wrong. See error details above.
                </p>
              )}
            </div>
          </div>
        )}

        {/* 错误提示 */}
        {error && !loading && (
          <div className="mt-6 p-4 bg-red-900/30 border border-red-700 rounded-lg text-red-300">
            ⚠️ {error}
            <button
              onClick={() => { setError(null); setProgressStage(''); }}
              className="ml-3 underline text-sm hover:text-red-200"
            >
              Try again
            </button>
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
                  ✅ 行动事项
                  <span className="text-sm font-normal text-slate-500">
                    ({actionItems.filter(a => a.completed).length}/{actionItems.length} 已完成)
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
                  📝 会议纪要
                </h3>
                <p className="text-slate-300 leading-relaxed">{summary}</p>
              </div>
            )}

            {decisions.length > 0 && (
              <div className="p-6 bg-slate-800/70 rounded-xl border border-slate-700">
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  🎯 关键决策
                </h3>
                <ul className="space-y-2">
                  {decisions.map((decision, idx) => (
                    <li key={idx} className="text-slate-300 flex items-start gap-2">
                      <span className="text-blue-400 mt-1">•</span>
                      {decision}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="p-4 bg-slate-700/50 rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-lg">📋 完整文本</h3>
                <button
                  onClick={copyResult}
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-sm"
                >
                  复制全文
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
        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .animate-gradient-shift {
          animation: gradient-shift 2s ease infinite;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.5s ease-out forwards;
        }
        @keyframes fade-in-toast {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
