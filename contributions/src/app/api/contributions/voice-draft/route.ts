import { createVoicePost } from '@/lib/contributions/voice/handlers';
import { extractVoice, transcribeVoice } from '@/lib/contributions/voice/gateway';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 50;
export const POST = createVoicePost({ transcribe: transcribeVoice, extract: extractVoice });
