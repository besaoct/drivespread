import { useEffect, useState, useRef } from 'react';
import { DriveSpreadClient } from 'drivespread/client';

interface Todo {
  _id: string;
  _version: number;
  title: string;
  completed: boolean;
  priority: number; // 1=Low, 2=Medium, 3=High
  createdAt: string;
}

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<number>(2); // Default to Medium
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const clientRef = useRef<DriveSpreadClient | null>(null);

  // Helper to establish WebSocket connection and sync state
  useEffect(() => {
    // 1. Fetch initial todos list over HTTP REST
    const fetchTodos = async () => {
      try {
        const res = await fetch('/api/todos');
        if (res.ok) {
          const data = await res.json();
          setTodos(data);
        }
      } catch (err) {
        console.error('Failed to load initial todos:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTodos();

    // 2. Set up WebSockets real-time sync client
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // During dev: proxy handles HTTP, but WebSockets go direct to port 3000
    const wsHost = window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.host;
    const wsUrl = `${wsProtocol}//${wsHost}`;

    console.log(`Connecting to DriveSpread WebSocket at ${wsUrl}...`);
    
    // Create client
    const client = new DriveSpreadClient(wsUrl);
    clientRef.current = client;

    // Listen to WebSocket connection state (using open event inside the DriveSpreadClient wrapper)
    // We override console.log or capture websocket events to check state
    const socketInstance = (client as any).ws;
    if (socketInstance) {
      setIsConnected(socketInstance.readyState === WebSocket.OPEN);
      socketInstance.addEventListener('open', () => setIsConnected(true));
      socketInstance.addEventListener('close', () => setIsConnected(false));
      socketInstance.addEventListener('error', () => setIsConnected(false));
    }

    // Subscribe to "todos" database updates
    client.subscribe('todos', {}, (event: any) => {
      const { type, row } = event;
      if (!row || !row._id) return;

      setTodos((prevTodos) => {
        switch (type) {
          case 'insert':
            // Avoid duplicate insertion if local action already inserted
            if (prevTodos.some((t) => t._id === row._id)) {
              return prevTodos;
            }
            return [row, ...prevTodos];
          
          case 'update':
            return prevTodos.map((t) => (t._id === row._id ? row : t));
          
          case 'delete':
            return prevTodos.filter((t) => t._id !== row._id);
          
          default:
            return prevTodos;
        }
      });
    });

    return () => {
      console.log('Cleaning up WebSocket subscription...');
      client.close();
    };
  }, []);

  // Form submission: Create Todo
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
        // Optimistically insert locally (real-time stream will double check)
        setTodos((prev) => {
          if (prev.some((t) => t._id === newTodo._id)) return prev;
          return [newTodo, ...prev];
        });
        setTitle('');
        setPriority(2); // Reset to Medium
      }
    } catch (err) {
      console.error('Failed to create todo:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle todo completion state
  const handleToggle = async (todo: Todo) => {
    try {
      const nextCompleted = !todo.completed;
      // Optimistically update state
      setTodos((prev) =>
        prev.map((t) => (t._id === todo._id ? { ...t, completed: nextCompleted } : t))
      );

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
        // Rollback on failure
        setTodos((prev) =>
          prev.map((t) => (t._id === todo._id ? todo : t))
        );
      }
    } catch (err) {
      console.error('Failed to update todo status:', err);
    }
  };

  // Delete Todo
  const handleDelete = async (id: string) => {
    // Find the item to rollback if delete fails
    const itemToDelete = todos.find((t) => t._id === id);
    if (!itemToDelete) return;

    try {
      // Optimistically remove from list
      setTodos((prev) => prev.filter((t) => t._id !== id));

      const res = await fetch(`/api/todos/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        // Rollback
        setTodos((prev) => [itemToDelete, ...prev]);
      }
    } catch (err) {
      console.error('Failed to delete todo:', err);
    }
  };

  // Sorting logic: Uncompleted first, then by priority (High -> Medium -> Low), then newest first
  const sortedTodos = [...todos].sort((a, b) => {
    if (a.completed !== b.completed) {
      return a.completed ? 1 : -1;
    }
    if (b.priority !== a.priority) {
      return b.priority - a.priority; // High priority (3) first
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const completedCount = todos.filter((t) => t.completed).length;
  const totalCount = todos.length;

  return (
    <div className="todo-container">
      <div className="todo-header">
        <h1>DriveSpread Todo</h1>
        <p>Real-time Google Sheets Database Demo</p>
        
        <div className={`connection-badge ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className={`badge-dot ${isConnected ? 'pulse' : ''}`} />
          {isConnected ? 'Sync Connected' : 'Connecting Sync...'}
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="value">{totalCount}</div>
          <div className="label">Total Tasks</div>
        </div>
        <div className="stat-card">
          <div className="value">{completedCount}</div>
          <div className="label">Completed</div>
        </div>
        <div className="stat-card">
          <div className="value">
            {totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%
          </div>
          <div className="label">Progress</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="todo-form">
        <div className="form-inputs">
          <input
            type="text"
            className="todo-input"
            placeholder="Add a new task..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            required
          />
          <select
            className="priority-select"
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            disabled={submitting}
          >
            <option value={3}>🔥 High</option>
            <option value={2}>⚡ Medium</option>
            <option value={1}>💧 Low</option>
          </select>
        </div>
        <button type="submit" className="todo-submit-btn" disabled={submitting}>
          {submitting ? 'Saving to Sheets...' : 'Add Task'}
        </button>
      </form>

      {loading ? (
        <div className="todo-empty-state">
          <p>Syncing with Google Sheets...</p>
        </div>
      ) : sortedTodos.length === 0 ? (
        <div className="todo-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p>No tasks yet. Create one above!</p>
        </div>
      ) : (
        <div className="todo-list">
          {sortedTodos.map((todo) => (
            <div key={todo._id} className={`todo-item ${todo.completed ? 'completed' : ''}`}>
              <div className="todo-checkbox-wrapper" onClick={() => handleToggle(todo)}>
                <div className="todo-checkbox" />
              </div>
              
              <span className="todo-item-title">{todo.title}</span>

              <span className={`priority-tag ${todo.priority === 3 ? 'high' : todo.priority === 2 ? 'medium' : 'low'}`}>
                {todo.priority === 3 ? 'High' : todo.priority === 2 ? 'Medium' : 'Low'}
              </span>

              <button
                type="button"
                className="todo-delete-btn"
                onClick={() => handleDelete(todo._id)}
                title="Delete task"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="todo-footnote">
        Data synced directly to your private Google Drive namespace.
      </div>
    </div>
  );
}
