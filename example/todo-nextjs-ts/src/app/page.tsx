import { db } from '@/lib/db';
import TodoList from './TodoList';

export const dynamic = 'force-dynamic';

export default async function Home() {
  let initialTodos: any[] = [];
  try {
    initialTodos = await db.collection('todos').find();
  } catch (err) {
    console.error('Failed to load todos on the server:', err);
  }

  // Ensure plain JSON objects are passed to the client component (RSC boundary)
  const serializedTodos = JSON.parse(JSON.stringify(initialTodos));

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <TodoList initialTodos={serializedTodos} />
    </main>
  );
}
