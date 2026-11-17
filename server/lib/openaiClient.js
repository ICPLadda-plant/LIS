const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || OPENAI_MODEL;

// OCR (reading text from images) goes through the 9router OpenAI-compatible gateway.
const OCR_API_BASE_URL = (process.env.OCR_API_BASE_URL || 'https://9router-plant.icpladda.com/v1').replace(/\/+$/, '');

function getOcrConfig() {
  return {
    baseUrl: OCR_API_BASE_URL,
    apiKey: process.env.OCR_API_KEY || '',
    model: process.env.OCR_MODEL || '',
  };
}

function isOcrConfigured() {
  const { apiKey, model } = getOcrConfig();
  return Boolean(apiKey && model);
}

function isOpenAIConfigured() {
  return Boolean(OPENAI_API_KEY);
}

async function generateStream(prompt, onChunk, options = {}) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || OPENAI_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI stream failed: ${response.status} ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const chunk = json.choices?.[0]?.delta?.content;
        if (chunk) onChunk(chunk);
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
}

// Non-streaming call that forces a JSON object response (OpenAI JSON mode).
// Returns the parsed object. Throws on transport error or unparseable output.
async function generateJSON(prompt, options = {}) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || OPENAI_MODEL,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 1800,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI request failed: ${response.status} ${errText}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned empty content');
  return JSON.parse(content);
}

async function generateJSONFromImage(prompt, imageDataUrl, options = {}) {
  const ocr = getOcrConfig();
  if (!ocr.apiKey || !ocr.model) throw new Error('OCR_API_KEY / OCR_MODEL not configured');

  const response = await fetch(`${ocr.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ocr.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || ocr.model,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: options.detail || 'high' } },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 800,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OCR request failed: ${response.status} ${errText}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('OCR returned empty content');
  // Some gateway models wrap JSON in markdown fences; strip them before parsing.
  return JSON.parse(String(content).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
}

// Non-streaming plain-text completion. Returns the assistant message text (or '').
// Used where the caller needs the full answer in one shot (e.g. a LINE reply).
async function generateText(prompt, options = {}) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || OPENAI_MODEL,
      messages: [
        ...(options.system ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: options.temperature ?? 0.4,
      max_tokens: options.maxTokens ?? 500,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`OpenAI request failed: ${response.status} ${errText}`);
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content ?? '';
}

module.exports = { isOpenAIConfigured, isOcrConfigured, getOcrConfig, generateStream, generateJSON, generateJSONFromImage, generateText, OPENAI_MODEL };
