'use client';

import { useState } from 'react';

interface Todo {
  _id: string;
  title: string;
  completed: boolean;
  priority: number;
  createdAt: string;
}

interface TodoListProps {
  initialTodos: Todo[];
}

export default function TodoList({ initialTodos }: TodoListProps) {
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<number>(2);
  const [submitting, setSubmitting] = useState(false);

  // Create Todo
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          completed: false,
          priority: Number(priority),
        }),
      });

      if (res.ok) {
        const newTodo = await res.json();
        setTodos((prev) => [newTodo, ...prev]);
        setTitle('');
        setPriority(2);
      }
    } catch (err) {
      console.error('Failed to create todo:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle Complete status
  const handleToggle = async (todo: Todo) => {
    const nextCompleted = !todo.completed;
    
    // Optimistic UI Update
    setTodos((prev) =>
      prev.map((t) => (t._id === todo._id ? { ...t, completed: nextCompleted } : t))
    );

    try {
      const res = await fetch(`/api/todos/${todo._id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          completed: nextCompleted,
        }),
      });

      if (!res.ok) {
        // Rollback state on error
        setTodos((prev) =>
          prev.map((t) => (t._id === todo._id ? todo : t))
        );
      }
    } catch (err) {
      console.error('Failed to update todo status:', err);
      // Rollback
      setTodos((prev) =>
        prev.map((t) => (t._id === todo._id ? todo : t))
      );
    }
  };

  // Delete Todo
  const handleDelete = async (id: string) => {
    const itemToDelete = todos.find((t) => t._id === id);
    if (!itemToDelete) return;

    // Optimistic UI Update
    setTodos((prev) => prev.filter((t) => t._id !== id));

    try {
      const res = await fetch(`/api/todos/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        // Rollback state on error
        setTodos((prev) => [itemToDelete, ...prev]);
      }
    } catch (err) {
      console.error('Failed to delete todo:', err);
      // Rollback
      setTodos((prev) => [itemToDelete, ...prev]);
    }
  };

  // Sort: Uncompleted first, then by priority (High -> Medium -> Low), then newest first
  const sortedTodos = [...todos].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    if (b.priority !== a.priority) {
      return b.priority - a.priority; // 3 (High) comes first
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const totalCount = todos.length;
  const completedCount = todos.filter((t) => t.completed).length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="w-full max-w-2xl bg-slate-900/60 backdrop-blur-md border border-white/8 rounded-3xl p-8 shadow-2xl">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-extrabold tracking-tight bg-linear-to-r from-white to-purple-400 bg-clip-text text-transparent mb-2">
          DriveSpread Next.js Todo
        </h1>
        <p className="text-gray-400 text-sm">
          Server Component fetch + Route Handler API updates using Google Sheets
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white/3 border border-white/4 rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-white mb-1">{totalCount}</div>
          <div className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">Total Tasks</div>
        </div>
        <div className="bg-white/3 border border-white/4 rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-white mb-1">{completedCount}</div>
          <div className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">Completed</div>
        </div>
        <div className="bg-white/3 border border-white/4 rounded-2xl p-4 text-center">
          <div className="text-2xl font-bold text-white mb-1">{progressPercent}%</div>
          <div className="text-gray-400 text-[10px] uppercase tracking-wider font-semibold">Progress</div>
        </div>
      </div>

      {/* Input Form */}
      <form onSubmit={handleSubmit} className="bg-white/2 border border-white/4 rounded-2xl p-4 flex flex-col gap-3 mb-8">
        <div className="flex gap-3 flex-col sm:flex-row">
          <input
            type="text"
            className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-sm transition"
            placeholder="Add a new task..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            required
          />
          <select
            className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-purple-500 text-sm cursor-pointer transition"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            disabled={submitting}
          >
            <option value={3}>🔥 High</option>
            <option value={2}>⚡ Medium</option>
            <option value={1}>💧 Low</option>
          </select>
        </div>
        <button
          type="submit"
          className="bg-linear-to-r from-purple-500 to-blue-500 text-white font-semibold rounded-xl py-3 text-sm hover:opacity-95 active:translate-y-px transition shadow-lg shadow-purple-500/20"
          disabled={submitting}
        >
          {submitting ? 'Creating in Sheets...' : 'Add Task'}
        </button>
      </form>

      {/* Tasks List */}
      {sortedTodos.length === 0 ? (
        <div className="text-center py-12 text-gray-400 flex flex-col items-center justify-center gap-3">
          <svg className="opacity-40" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p className="text-sm">No tasks found. Create one above!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto pr-1">
          {sortedTodos.map((todo) => (
            <div
              key={todo._id}
              className={`flex items-center gap-4 bg-white/3 border border-white/5 rounded-2xl p-4 hover:bg-white/5 hover:translate-x-1 transition-all duration-200 ${
                todo.completed ? 'opacity-65' : ''
              }`}
            >
              {/* Checkbox */}
              <div className="cursor-pointer flex items-center justify-center" onClick={() => handleToggle(todo)}>
                <div
                  className={`w-[22px] h-[22px] rounded-md border-2 transition flex items-center justify-center ${
                    todo.completed
                      ? 'bg-purple-500 border-purple-500'
                      : 'border-gray-500 hover:border-purple-400'
                  }`}
                >
                  {todo.completed && (
                    <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>

              {/* Title */}
              <span className={`flex-1 text-sm text-gray-100 ${todo.completed ? 'line-through text-gray-500' : ''}`}>
                {todo.title}
              </span>

              {/* Priority Tag */}
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border ${
                  todo.priority === 3
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                    : todo.priority === 2
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                }`}
              >
                {todo.priority === 3 ? 'High' : todo.priority === 2 ? 'Medium' : 'Low'}
              </span>

              {/* Delete Button */}
              <button
                type="button"
                className="text-gray-400 hover:text-rose-500 hover:bg-rose-500/10 p-1.5 rounded-lg transition"
                onClick={() => handleDelete(todo._id)}
                title="Delete task"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-[11px] text-gray-500 mt-6">
        Database credentials held securely on the server. Sheets API writes batched & rate-limited.
      </div>
    </div>
  );
}
