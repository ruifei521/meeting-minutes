'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface ActionItem {
  id: string;
  task: string;
  owner: string;
  completed: boolean;
}

interface MeetingData {
  id: string;
  summary: string;
  decisions: string[];
  actionItems: ActionItem[];
  transcript: string;
  createdAt: number;
}

export default function MinutesPage() {
  const params = useParams();
  const id = params.id as string;

  const [meeting, setMeeting] = useState<MeetingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 动态获取当前域名，避免硬编码
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/minutes/${id}`
    : `/minutes/${id}`;

  useEffect(() => {
    fetchMeeting();
  }, [id]);

  const fetchMeeting = async () => {
    try {
      const res = await fetch(`/api/meeting/${id}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Meeting not found');
      }
      const data = await res.json();
      setMeeting(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleAction = async (actionId: string) => {
    try {
      const res = await fetch('/api/toggle-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId: id, actionId }),
      });
      const data = await res.json();
      if (data.success && meeting) {
        setMeeting({ ...meeting, actionItems: data.actionItems });
      } else {
        setToast(data.error || 'Failed to update action item');
        setTimeout(() => setToast(null), 3000);
      }
    } catch (err) {
      console.error('Failed to toggle:', err);
      setToast('Network error — please check your connection and try again');
      setTimeout(() => setToast(null), 3000);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const completedCount = meeting?.actionItems?.filter(a => a.completed)?.length ?? 0;
  const totalCount = meeting?.actionItems?.length ?? 0;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl animate-spin mb-4">⚙️</div>
          <p className="text-slate-400">Loading your action items...</p>
        </div>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">😕</div>
          <h1 className="text-2xl font-bold mb-2">Meeting Not Found</h1>
          <p className="text-slate-400">{error || 'This link may have expired (links last 30 days)'}</p>
          <a href="/" className="mt-6 inline-block text-blue-400 hover:text-blue-300">
            ← Create new meeting minutes
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white">
      {/* Toast 通知 */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-red-500/90 text-white px-5 py-3 rounded-lg shadow-lg text-sm animate-fade-in flex items-center gap-2">
          ⚠️ {toast}
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-slate-500 text-sm mb-2">
            <span>📋 Action Tracker</span>
            <span>•</span>
            <span>{formatDate(meeting.createdAt)}</span>
          </div>
          <h1 className="text-3xl font-bold">Meeting Minutes</h1>
        </div>

        {/* Progress Bar */}
        <div className="bg-slate-800 rounded-xl p-6 mb-6">
          <div className="flex justify-between items-center mb-3">
            <span className="text-slate-400">Progress</span>
            <span className="font-semibold">{completedCount}/{totalCount} actions completed</span>
          </div>
          <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {totalCount > 0 && completedCount === totalCount && (
            <div className="mt-3 text-green-400 text-sm flex items-center gap-2">
              🎉 All tasks completed!
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="bg-slate-800 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            📝 Summary
          </h2>
          <p className="text-slate-300 leading-relaxed">{meeting.summary}</p>
        </div>

        {/* Key Decisions */}
        {meeting.decisions.length > 0 && (
          <div className="bg-slate-800 rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              🎯 Key Decisions
            </h2>
            <ul className="space-y-2">
              {meeting.decisions.map((decision, idx) => (
                <li key={idx} className="text-slate-300 flex items-start gap-2">
                  <span className="text-blue-400 mt-1">•</span>
                  {decision}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Items */}
        <div className="bg-slate-800 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            ✅ Action Items
            {totalCount > 0 && (
              <span className="text-sm font-normal text-slate-500">
                ({completedCount}/{totalCount} done)
              </span>
            )}
          </h2>

          {meeting.actionItems.length === 0 ? (
            <p className="text-slate-500 text-sm">No action items were detected.</p>
          ) : (
            <ul className="space-y-3">
              {meeting.actionItems.map((action) => (
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
          )}
        </div>

        {/* Transcript (collapsed) */}
        <details className="bg-slate-800/50 rounded-xl mb-6">
          <summary className="p-4 cursor-pointer text-slate-400 hover:text-slate-300 text-sm">
            📄 Show full transcript
          </summary>
          <pre className="px-4 pb-4 text-slate-500 text-xs leading-relaxed whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">
            {meeting.transcript}
          </pre>
        </details>

        {/* Share & Actions */}
        <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 rounded-xl p-6 text-center">
          <p className="text-slate-300 text-sm mb-3">
            🔗 Share this page with your team to track progress together
          </p>
          <div className="flex items-center justify-center gap-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-300 w-80"
            />
            <button
              onClick={() => {
                navigator.clipboard.writeText(shareUrl);
              }}
              className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              📋 Copy
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-slate-600 text-sm">
          <a href="/" className="text-blue-400 hover:text-blue-300">
            ← Create new meeting minutes
          </a>
        </div>
      </div>
    </div>
  );
}
