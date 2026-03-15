const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
];

const prompts = yaml.load(
  fs.readFileSync(path.join(__dirname, '..', 'prompts.yaml'), 'utf8')
);

// Track last Groq call to enforce 30 RPM rate limit (2s between calls)
let lastGroqCall = 0;
const GROQ_DELAY_MS = 2100;

// Track which model index to start from — persists across calls within a run
// so once a model 429s, we skip it for all remaining posts
let currentModelIndex = 0;

function resetModelIndex() {
  currentModelIndex = 0;
}

async function groqScore(systemPrompt, userPrompt) {
  for (let i = currentModelIndex; i < GROQ_MODELS.length; i++) {
    const model = GROQ_MODELS[i];

    const elapsed = Date.now() - lastGroqCall;
    if (elapsed < GROQ_DELAY_MS) {
      await new Promise((r) => setTimeout(r, GROQ_DELAY_MS - elapsed));
    }
    lastGroqCall = Date.now();

    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 32,
        stop: ['\n', '.', ',', ' '],
      }),
    });

    if (res.status === 429 && i < GROQ_MODELS.length - 1) {
      console.warn(`[scorer] Groq 429 on ${model}, falling back to ${GROQ_MODELS[i + 1]} for remaining posts`);
      currentModelIndex = i + 1;
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Groq API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    if (i > 0) {
      console.log(`[scorer] Scored using fallback model: ${model}`);
    }
    const raw = (data.choices[0].message.content || '').trim();
    if (!raw) {
      const reason = data.choices[0].finish_reason || 'unknown';
      if (i < GROQ_MODELS.length - 1) {
        console.warn(`[scorer] Empty response from ${model} (finish_reason: ${reason}), retrying with ${GROQ_MODELS[i + 1]}`);
        continue;
      }
      console.warn(`[scorer] Empty response from ${model} (finish_reason: ${reason}), no more fallbacks`);
      return 50;
    }
    // Extract first number from response — handles "Score: 72", "72/100", etc.
    const match = raw.match(/\d+/);
    const score = match ? parseInt(match[0], 10) : NaN;
    if (Number.isNaN(score)) {
      console.warn(`[scorer] Could not parse score from Groq response: "${raw}"`);
    }
    return Number.isNaN(score) ? 50 : Math.max(0, Math.min(100, score));
  }
}

async function scoreText(title, body) {
  const content = `Title: ${title}\n${body || ''}`.trim();
  return groqScore(
    prompts.text_scoring.system,
    prompts.text_scoring.user.replace('{content}', content)
  );
}

async function scoreComments(comments) {
  if (!comments || comments.length === 0) return 50;

  const numbered = '[' + comments
    .map((c) => `"${c.slice(0, 300)}"`)
    .join(', ') + ']';

  return groqScore(
    prompts.comment_scoring.system,
    prompts.comment_scoring.user.replace('{content}', numbered)
  );
}

// Track last Gemini call to enforce 15 RPM rate limit (4s between calls)
let lastGeminiCall = 0;
const GEMINI_DELAY_MS = 4500;

async function scoreImage(imageUrl) {
  if (!imageUrl) return null;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) return null;

  const arrayBuf = await imageRes.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString('base64');
  const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';

  // Rate limit: wait if needed to stay under 15 RPM
  const elapsed = Date.now() - lastGeminiCall;
  if (elapsed < GEMINI_DELAY_MS) {
    await new Promise((r) => setTimeout(r, GEMINI_DELAY_MS - elapsed));
  }
  lastGeminiCall = Date.now();

  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType } },
    prompts.image_scoring.prompt,
  ]);

  const raw = result.response.text().trim();
  const score = parseInt(raw, 10);
  return Number.isNaN(score) ? 50 : Math.max(0, Math.min(100, score));
}

async function scorePost(post) {
  const textScore = await scoreText(post.title, post.body);
  const commentScore = await scoreComments(post.top_comments);
  const imageScore = await scoreImage(post.image_url);

  let positivityScore;
  if (imageScore !== null) {
    positivityScore = Math.round(
      textScore * 0.3 + commentScore * 0.3 + imageScore * 0.4
    );
  } else {
    positivityScore = Math.round(textScore * 0.6 + commentScore * 0.4);
  }

  return {
    text_score: textScore,
    comment_score: commentScore,
    image_score: imageScore,
    positivity_score: positivityScore,
  };
}

module.exports = { scorePost, scoreText, scoreComments, scoreImage, resetModelIndex };
