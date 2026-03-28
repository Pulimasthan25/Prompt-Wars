const { SYSTEM_INSTRUCTION } = require('./systemPrompt');
const { parseModelJson } = require('./parseModelJson');

const GEMINI_REST_MODEL = 'gemini-2.5-flash';

/**
 * @param {string} input
 * @returns {Promise<object>}
 */
async function generateBriefWithApiKey(input) {
  const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
  if (!API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const payload = {
    contents: [{ parts: [{ text: input }] }],
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    generationConfig: {
      responseMimeType: 'application/json',
    },
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_REST_MODEL}:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Generative Language API error: ${response.status} ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const part = data?.candidates?.[0]?.content?.parts?.[0];
  if (!part?.text) {
    throw new Error('Empty model response');
  }
  return parseModelJson(part.text);
}

/**
 * Vertex AI Gemini (Application Default Credentials on Cloud Run).
 * @param {string} input
 * @returns {Promise<object>}
 */
async function generateBriefWithVertex(input) {
  const { VertexAI } = require('@google-cloud/vertexai');
  const project =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT;
  const location = process.env.VERTEX_LOCATION || 'us-central1';
  const modelId = process.env.VERTEX_GEMINI_MODEL || 'gemini-1.5-flash';

  if (!project) {
    throw new Error('GOOGLE_CLOUD_PROJECT is required for Vertex AI');
  }

  const vertex = new VertexAI({ project, location });
  const model = vertex.getGenerativeModel({
    model: modelId,
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
  });

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: input }] }],
    generationConfig: {
      responseMimeType: 'application/json',
    },
  });

  const text = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Empty Vertex model response');
  }
  return parseModelJson(text);
}

/**
 * Prefers Vertex when USE_VERTEX_AI=true and project is set; otherwise API key REST.
 * @param {string} input
 * @returns {Promise<object>}
 */
async function generateBrief(input) {
  const useVertex = process.env.USE_VERTEX_AI === 'true';
  const hasProject =
    !!(process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT);

  if (useVertex && hasProject) {
    try {
      return await generateBriefWithVertex(input);
    } catch (e) {
      console.error('Vertex AI failed, falling back to API key if available:', e.message);
      if (process.env.GEMINI_API_KEY) {
        return generateBriefWithApiKey(input);
      }
      throw e;
    }
  }

  return generateBriefWithApiKey(input);
}

module.exports = {
  generateBrief,
  generateBriefWithApiKey,
  generateBriefWithVertex,
};
