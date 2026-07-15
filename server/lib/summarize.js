import { promises as fs } from 'fs';
import OpenAI from 'openai';

import { getConfig } from './config.js';

/**
 * send page content to GPT-4o vision and get back a structured summary.
 * uses the screenshot image + caption + title for richer context.
 *
 * @returns {{ summary: string, category: string, keywords: string, aiConfidence: number|null, aiConfidenceReason: string }}
 */
export async function summarize(url, title, caption, description, absoluteScreenshotPath, userMessage) {
  const config = getConfig();
  const categories = config.categories;

  if (process.env.MOCK === 'true') {
    return { summary: `mock summary for ${new URL(url).hostname}`, category: categories[0], keywords: 'mock, keywords', aiConfidence: null, aiConfidenceReason: '' };
  }

  const imageData = await fs.readFile(absoluteScreenshotPath);
  const base64 = imageData.toString('base64');
  if (!config.openaiApiKey) {
    throw new Error('OpenAI API key is not configured. Add it in Settings or OPENAI_API_KEY.');
  }

  const openai = new OpenAI({
    apiKey: config.openaiApiKey,
    ...(config.openaiBaseUrl ? { baseURL: config.openaiBaseUrl } : {}),
  });

  const intentClause = userMessage
    ? `The user saved this with the message: "${userMessage}". Use this as the primary signal for their intent — let it shape the summary wording and tip the category toward what the user cares about, not just what the page is generically about.`
    : '';

  const prompt = `You are a personal web archiver assistant. Analyze the screenshot and metadata below, then return a JSON object with exactly five fields:
- "summary": a single concise sentence (max 30 words) describing what the page is about and, if intent is clear, why the user saved it.
- "category": one or two of these categories: ${categories.join(', ')}.
- "keywords": comma separated list of maximum three relevant keywords.
- "confidence": an integer from 0 to 100 measuring confidence in this interpretation, not the quality of the content. Lower it when text is missing, ambiguous, unreadable, or conflicts with the screenshot.
- "confidenceReason": a short plain-language explanation (max 18 words) naming the strongest or missing evidence.
${intentClause}
URL: ${url}
Page Title: ${title || '(not available)'}
Caption: ${caption || description || '(not available)'}

Respond with only the raw JSON object, no markdown fences.`;

  const response = await openai.chat.completions.create({
    model: config.openaiModel,
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
  const aiConfidence = Number.isFinite(parsed.confidence)
    ? Math.max(0, Math.min(100, Math.round(parsed.confidence)))
    : null;
  const aiConfidenceReason = typeof parsed.confidenceReason === 'string'
    ? parsed.confidenceReason.trim().slice(0, 180)
    : '';

  const validParts = typeof parsed.category === 'string'
    ? parsed.category.split(',').map(c => c.trim()).filter(c => categories.includes(c))
    : [];

  if (validParts.length === 0) {
    console.warn(`[ig-archiver] unexpected category "${parsed.category}" from model, defaulting to ${categories[0]}`);
  }
  const category = validParts.length > 0 ? validParts.join(', ') : categories[0];

  return { summary, category, keywords, aiConfidence, aiConfidenceReason };
}

export { VALID_CATEGORIES } from './config.js';
