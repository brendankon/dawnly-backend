const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';

const prompts = yaml.load(
  fs.readFileSync(path.join(__dirname, '..', 'prompts.yaml'), 'utf8')
);

async function groqScore(systemPrompt, userPrompt) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
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
  const content = `Title: ${title}\n${body || ''}`.trim();
  return groqScore(
    prompts.text_scoring.system,
    prompts.text_scoring.user.replace('{content}', content)
  );
}

async function scoreComments(comments) {
  if (!comments || comments.length === 0) return 50;

  const scores = await Promise.all(
    comments.map((c) =>
      groqScore(
        prompts.comment_scoring.system,
        prompts.comment_scoring.user.replace('{content}', c)
      )
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

  const arrayBuf = await imageRes.arrayBuffer();
  const base64 = Buffer.from(arrayBuf).toString('base64');
  const mimeType = imageRes.headers.get('content-type') || 'image/jpeg';

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

module.exports = { scorePost, scoreText, scoreComments, scoreImage };
