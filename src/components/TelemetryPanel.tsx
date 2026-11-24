"use client";

import { useState } from "react";
import {
  Activity,
  CheckCircle2,
  Circle,
  Clock,
  ListTodo,
  NotebookPen,
  Plus,
  Trash2,
} from "lucide-react";
import { TOOL_DISPLAY_NAMES } from "@/lib/tools";
import type {
  JarvisNote,
  JarvisTask,
  JarvisTimer,
  ToolActionEvent,
} from "@/types/jarvis";

interface TelemetryPanelProps {
  nowMs: number;
  timers: JarvisTimer[];
  tasks: JarvisTask[];
  notes: JarvisNote[];
  toolLog: ToolActionEvent[];
  onAddTimer: (label: string, durationSeconds: number) => void;
  onRemoveTimer: (id: string) => void;
  onAddTask: (title: string, priority: "low" | "normal" | "high") => void;
  onToggleTask: (id: string) => void;
  onRemoveTask: (id: string) => void;
  onAddNote: (title: string, body: string) => void;
  onRemoveNote: (id: string) => void;
}

function formatCountdown(remainingSeconds: number): string {
  const clamped = Math.max(0, Math.ceil(remainingSeconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function TelemetryPanel({
  nowMs,
  timers,
  tasks,
  notes,
  toolLog,
  onAddTimer,
  onRemoveTimer,
  onAddTask,
  onToggleTask,
  onRemoveTask,
  onAddNote,
  onRemoveNote,
}: TelemetryPanelProps) {
  const [newTask, setNewTask] = useState("");
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [newNoteBody, setNewNoteBody] = useState("");
  const [showNoteForm, setShowNoteForm] = useState(false);

  const openTaskCount = tasks.filter((t) => !t.completed).length;

  return (
    <aside className="hud-panel hud-scrollbar flex h-full w-full flex-col gap-4 overflow-y-auto border-y-0 border-r-0 p-4">
      <div className="flex items-center justify-between border-b border-[var(--hud-border)] pb-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-[var(--hud-accent)]" />
          <h2 className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--hud-text)]">
            HUD TELEMETRY
          </h2>
        </div>
        <span className="font-mono text-[10px] text-[var(--hud-muted)]">
          LIVE SYNC
        </span>
      </div>

      {/* Chronometers / Timers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
            <Clock className="h-3.5 w-3.5" />
            <span>Chronometers ({timers.length})</span>
          </span>
          <button
            type="button"
            onClick={() => onAddTimer("Quick Timer", 300)}
            className="inline-flex items-center gap-1 rounded border border-[var(--hud-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--hud-muted)] hover:border-[var(--hud-border-strong)] hover:text-[var(--hud-text)]"
          >
            <Plus className="h-2.5 w-2.5" />
            <span>5m</span>
          </button>
        </div>

        {timers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--hud-border)]/70 px-3 py-2 text-xs text-[var(--hud-muted)]">
            No active timers. Ask J.A.R.V.I.S. to start one anytime.
          </p>
        ) : (
          <div className="space-y-2">
            {timers.map((timer) => {
              const remaining = Math.max(0, (timer.endsAt - nowMs) / 1000);
              const pct = Math.min(
                100,
                Math.max(0, (remaining / Math.max(1, timer.durationSeconds)) * 100)
              );
              const finished = remaining <= 0;
              return (
                <div
                  key={timer.id}
                  className={`rounded-xl border p-2.5 ${
                    finished
                      ? "border-amber-400/60 bg-amber-500/15"
                      : "border-[var(--hud-border)] bg-black/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-[var(--hud-text)]">
                      {timer.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-mono text-xs tabular-nums ${
                          finished
                            ? "font-bold text-amber-300 animate-pulse"
                            : "text-[var(--hud-accent)]"
                        }`}
                      >
                        {finished ? "COMPLETE" : formatCountdown(remaining)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveTimer(timer.id)}
                        className="text-[var(--hud-muted)] hover:text-red-300"
                        title="Dismiss timer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-[var(--hud-accent)] transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mission Queue / Tasks */}
      <div className="space-y-2 border-t border-[var(--hud-border)]/70 pt-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
            <ListTodo className="h-3.5 w-3.5" />
            <span>Mission Queue ({openTaskCount})</span>
          </span>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTask.trim()) return;
            onAddTask(newTask.trim(), "normal");
            setNewTask("");
          }}
          className="flex gap-1.5"
        >
          <input
            type="text"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Add task..."
            className="min-w-0 flex-1 rounded-lg border border-[var(--hud-border)] bg-black/30 px-2.5 py-1.5 text-xs text-[var(--hud-text)] placeholder:text-[var(--hud-muted)]/60 focus:border-[var(--hud-border-strong)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newTask.trim()}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[var(--hud-border)] bg-[var(--hud-accent-soft)] text-[var(--hud-accent)] hover:border-[var(--hud-border-strong)] disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </form>

        {tasks.length === 0 ? (
          <p className="text-xs text-[var(--hud-muted)]">
            Queue clear. Add tasks manually or tell J.A.R.V.I.S.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {tasks.map((task) => (
              <li
                key={task.id}
                className="group flex items-start gap-2 rounded-lg border border-[var(--hud-border)]/70 bg-black/25 px-2.5 py-2 text-xs"
              >
                <button
                  type="button"
                  onClick={() => onToggleTask(task.id)}
                  className="mt-0.5 shrink-0 text-[var(--hud-accent)]"
                  title={task.completed ? "Mark incomplete" : "Mark completed"}
                >
                  {task.completed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 opacity-75" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`leading-snug ${
                      task.completed
                        ? "line-through text-[var(--hud-muted)]"
                        : "text-[var(--hud-text)]"
                    }`}
                  >
                    {task.title}
                  </p>
                  {task.priority === "high" && !task.completed && (
                    <span className="mt-0.5 inline-block rounded bg-amber-500/20 px-1 py-0.5 font-mono text-[9px] uppercase text-amber-300">
                      HIGH PRIORITY
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveTask(task.id)}
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-[var(--hud-muted)] hover:text-red-300"
                  title="Delete task"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Memory Bank / Notes */}
      <div className="space-y-2 border-t border-[var(--hud-border)]/70 pt-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
            <NotebookPen className="h-3.5 w-3.5" />
            <span>Memory Bank ({notes.length})</span>
          </span>
          <button
            type="button"
            onClick={() => setShowNoteForm((v) => !v)}
            className="inline-flex items-center gap-1 rounded border border-[var(--hud-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--hud-muted)] hover:border-[var(--hud-border-strong)] hover:text-[var(--hud-text)]"
          >
            <Plus className="h-2.5 w-2.5" />
            <span>{showNoteForm ? "CLOSE" : "NOTE"}</span>
          </button>
        </div>

        {showNoteForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newNoteTitle.trim() && !newNoteBody.trim()) return;
              onAddNote(
                newNoteTitle.trim() || "Quick Note",
                newNoteBody.trim()
              );
              setNewNoteTitle("");
              setNewNoteBody("");
              setShowNoteForm(false);
            }}
            className="space-y-1.5 rounded-xl border border-[var(--hud-border)] bg-black/35 p-2.5"
          >
            <input
              type="text"
              value={newNoteTitle}
              onChange={(e) => setNewNoteTitle(e.target.value)}
              placeholder="Note title..."
              className="w-full rounded border border-[var(--hud-border)] bg-black/30 px-2 py-1 text-xs text-[var(--hud-text)] focus:outline-none"
            />
            <textarea
              rows={2}
              value={newNoteBody}
              onChange={(e) => setNewNoteBody(e.target.value)}
              placeholder="Note details..."
              className="w-full resize-none rounded border border-[var(--hud-border)] bg-black/30 px-2 py-1 text-xs text-[var(--hud-text)] focus:outline-none"
            />
            <button
              type="submit"
              className="w-full rounded-lg border border-[var(--hud-border-strong)] bg-[var(--hud-accent-soft)] py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--hud-accent)] hover:bg-[var(--hud-accent)] hover:text-slate-950"
            >
              STORE NOTE
            </button>
          </form>
        )}

        {notes.length === 0 ? (
          <p className="text-xs text-[var(--hud-muted)]">
            No saved briefings yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {notes.map((note) => (
              <div
                key={note.id}
                className="group rounded-lg border border-[var(--hud-border)]/70 bg-black/25 p-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-[var(--hud-text)]">
                    {note.title}
                  </p>
                  <button
                    type="button"
                    onClick={() => onRemoveNote(note.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100 text-[var(--hud-muted)] hover:text-red-300"
                    title="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                {note.body && (
                  <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--hud-muted)]">
                    {note.body}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tool Telemetry Log */}
      {toolLog.length > 0 && (
        <div className="space-y-2 border-t border-[var(--hud-border)]/70 pt-3">
          <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--hud-accent)]">
            Subsystem Activity
          </span>
          <div className="space-y-1.5">
            {toolLog.slice(0, 8).map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-[var(--hud-border)]/60 bg-black/25 px-2.5 py-1.5 font-mono text-[10px]"
              >
                <div className="flex items-center justify-between text-[var(--hud-accent)]">
                  <span>{TOOL_DISPLAY_NAMES[entry.name] || entry.name}</span>
                  <span className="text-[var(--hud-muted)]">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="mt-0.5 text-[var(--hud-muted)]">{entry.summary}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
