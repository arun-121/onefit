/**
 * Groq API client (OpenAI-compatible). Two calls:
 *  - parseMealText: description -> items
 *  - transcribeAudio: voice note -> text (Whisper)
 */
import * as SecureStore from 'expo-secure-store';

import { buildSystemPrompt, MEAL_JSON_SCHEMA, parseMealResponse, type ParsedMeal } from './ai-parse';
import type { FoodItem } from './types';

const BASE_URL = 'https://api.groq.com/openai/v1';
const KEY_STORE_NAME = 'groq_api_key';

export class GroqError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly detail: string = '',
  ) {
    super(message);
    this.name = 'GroqError';
  }
}

// ---------- API key ----------

/** Key saved in Settings wins; otherwise fall back to EXPO_PUBLIC_GROQ_API_KEY from .env. */
export async function getApiKey(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(KEY_STORE_NAME);
  return stored?.trim() || process.env.EXPO_PUBLIC_GROQ_API_KEY?.trim() || null;
}

export async function getStoredApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_STORE_NAME);
}

export async function saveApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) await SecureStore.setItemAsync(KEY_STORE_NAME, trimmed);
  else await SecureStore.deleteItemAsync(KEY_STORE_NAME);
}

export function hasEnvApiKey(): boolean {
  return !!process.env.EXPO_PUBLIC_GROQ_API_KEY?.trim();
}

// ---------- transport ----------

function friendlyMessage(status: number, detail: string, model?: string): string {
  const lower = detail.toLowerCase();
  if (status === 401) return 'Groq rejected the API key. Check it in Settings.';
  if (
    model &&
    (status === 404 || lower.includes('decommissioned') || lower.includes('does not exist') || lower.includes('model_not_found'))
  ) {
    return `The model "${model}" isn't available on Groq any more. Pick another one in Settings → AI models.`;
  }
  if (status === 413) return 'That recording is too long for Groq. Keep voice notes under a minute.';
  if (status === 429) return "You've hit Groq's free-tier limit. Wait a minute and try again.";
  if (status >= 500) return 'Groq is having problems right now. Try again shortly.';
  return `Groq error ${status}: ${detail || 'unknown error'}`;
}

async function groqFetch<T>(path: string, init: RequestInit, model?: string, timeoutMs = 45_000): Promise<T> {
  const key = await getApiKey();
  if (!key) throw new GroqError('Add your Groq API key in Settings first.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } catch (e) {
    if (controller.signal.aborted) throw new GroqError('Groq took too long to answer. Try again.');
    throw new GroqError("Couldn't reach Groq. Check your internet connection.", undefined, String(e));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try {
      detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? text;
    } catch {
      // not JSON; keep raw text
    }
    throw new GroqError(friendlyMessage(res.status, detail, model), res.status, detail);
  }
  return (await res.json()) as T;
}

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
}

type ChatContent = string;

interface ChatMessage {
  role: 'system' | 'user';
  content: ChatContent;
}

async function chatForMeal(model: string, messages: ChatMessage[]): Promise<ParsedMeal> {
  const extra = model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {};
  const request = (responseFormat: object) =>
    groqFetch<ChatResponse>(
      '/chat/completions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.2, response_format: responseFormat, ...extra }),
      },
      model,
    );

  let data: ChatResponse;
  try {
    data = await request({
      type: 'json_schema',
      json_schema: { name: 'meal', strict: true, schema: MEAL_JSON_SCHEMA },
    });
  } catch (e) {
    // Some models only support plain JSON mode; retry once with that.
    if (e instanceof GroqError && e.status === 400 && /response_format|json_schema|structured|strict/i.test(e.detail)) {
      data = await request({ type: 'json_object' });
    } else {
      throw e;
    }
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new GroqError('Groq sent back an empty answer. Try again.');
  try {
    return parseMealResponse(content);
  } catch {
    throw new GroqError("Couldn't read Groq's answer. Try again, or rephrase the meal.");
  }
}

// ---------- public API ----------

export function parseMealText(text: string, model: string, knownFoods: readonly FoodItem[]): Promise<ParsedMeal> {
  return chatForMeal(model, [
    { role: 'system', content: buildSystemPrompt(knownFoods) },
    { role: 'user', content: text },
  ]);
}

const AUDIO_TYPES: Record<string, string> = {
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  '3gp': 'audio/3gpp',
  webm: 'audio/webm',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
};

export async function transcribeAudio(uri: string, model: string): Promise<string> {
  const ext = (uri.split('?')[0].split('.').pop() ?? 'm4a').toLowerCase();
  const form = new FormData();
  // React Native's FormData accepts a { uri, name, type } file descriptor.
  form.append('file', { uri, name: `meal.${ext}`, type: AUDIO_TYPES[ext] ?? 'audio/m4a' } as unknown as Blob);
  form.append('model', model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  form.append('prompt', 'Someone describing what they ate or drank, with amounts.');
  const data = await groqFetch<{ text?: string }>('/audio/transcriptions', { method: 'POST', body: form }, model, 60_000);
  return (data.text ?? '').trim();
}

/** Model IDs available to this key; used by Settings to check the configured models. */
export async function listModels(): Promise<string[]> {
  const data = await groqFetch<{ data?: { id: string }[] }>('/models', { method: 'GET' });
  return (data.data ?? []).map((m) => m.id).sort();
}
