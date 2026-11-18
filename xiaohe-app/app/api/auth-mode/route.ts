import { authMode } from '../../chatgpt-auth';
export function GET(): Response { return Response.json({ mode: authMode() }, { headers: { 'Cache-Control': 'no-store' } }); }
