import { promises as fs } from 'fs';
import OpenAI from 'openai';

import { VALID_CATEGORIES } from './config.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * send page content to GPT-4o vision and get back a structured summary.
 * uses the screenshot image + caption + title for richer context.
 *
 * @returns {{ summary: string, category: string, keywords: string }} summary is a concise description of the page, category is one of the predefined categories, and keywords is a comma-separated list of relevant keywords.
 */
export async function summarize(url, title, caption, description, absoluteScreenshotPath) {
  if (process.env.MOCK === 'true') {
    return { summary: `mock summary for ${new URL(url).hostname}`, category: 'Leisure', keywords: 'mock, keywords' };
  }

  const imageData = await fs.readFile(absoluteScreenshotPath);
  const base64 = imageData.toString('base64');

  const prompt = `You are a personal web archiver assistant. Analyze the screenshot and metadata below, then return a JSON object with exactly three fields:
- "summary": a single concise sentence (max 30 words) describing what the page is about.
- "category": one or two tops of these categories: ${VALID_CATEGORIES.join(', ')}.
- "keywords": comma separated list of maximum three relevant keywords.

URL: ${url}
Page Title: ${title || '(not available)'}
Caption: ${caption || description || '(not available)'}

Respond with only the raw JSON object, no markdown fences.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'low' } },
        { type: 'text', text: prompt },
      ],
    }],
    max_tokens: 160,
    temperature: 0.3,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? '{}';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // try to extract JSON if the model wrapped it in a code block
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }

  const summary  = typeof parsed.summary  === 'string' ? parsed.summary.trim()  : 'No summary available.';
  const keywords = typeof parsed.keywords === 'string' ? parsed.keywords.trim() : '';

  const validParts = typeof parsed.category === 'string'
    ? parsed.category.split(',').map(c => c.trim()).filter(c => VALID_CATEGORIES.includes(c))
    : [];

  if (validParts.length === 0) {
    console.warn(`[ig-archiver] unexpected category "${parsed.category}" from model, defaulting to Leisure`);
  }
  const category = validParts.length > 0 ? validParts.join(', ') : 'Leisure';

  return { summary, category, keywords };
}

export { VALID_CATEGORIES } from './config.js';
