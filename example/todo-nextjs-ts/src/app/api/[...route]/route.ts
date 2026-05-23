import { db } from '@/lib/db';

const handler = db.nextHandler();

export const GET = handler.GET;
export const POST = handler.POST;
export const PUT = handler.PUT;
export const PATCH = handler.PATCH;
export const DELETE = handler.DELETE;
export const dynamic = 'force-dynamic';
