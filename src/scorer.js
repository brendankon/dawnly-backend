const fetch = require('node-fetch');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';

async function groqScore(prompt) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a sentiment scorer. Respond with ONLY a single integer from 0 to 100 representing how positive the content is. 0 = extremely negative, 50 = neutral, 100 = extremely positive. No explanation, just the number.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 8,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const raw = data.choices[0].message.content.trim();
  const score = parseInt(raw, 10);
  return Number.isNaN(score) ? 50 : Math.max(0, Math.min(100, score));
}

async function scoreText(title, body) {
  const text = `Title: ${title}\n${body || ''}`.trim();
  return groqScore(`Rate the positivity of this post:\n\n${text}`);
}

async function scoreComments(comments) {
  if (!comments || comments.length === 0) return 50;

  const scores = await Promise.all(
    comments.map((c) =>
      groqScore(`Rate the positivity of this comment:\n\n${c}`)
    )
  );

  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

async function scoreImage(imageUrl) {
  if (!imageUrl) return null;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) return null;

  const buffer = await imageRes.buffer();
  const base64 = buffer.toString('base64');
  const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';

  const result = await model.generateContent([
    {
      inlineData: { data: base64, mimeType },
    },
    'Rate the positivity of this image on a scale of 0 to 100. 0 = extremely negative, 50 = neutral, 100 = extremely positive. Respond with ONLY a single integer. No explanation.',
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

module.exports = { scorePost, scoreText, scoreComments, scoreImage };
