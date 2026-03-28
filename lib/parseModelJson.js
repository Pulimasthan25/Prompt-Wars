/**
 * Normalizes model output text and parses JSON (handles ```json fences).
 * @param {string} resultText
 * @returns {object}
 */
function parseModelJson(resultText) {
  if (typeof resultText !== 'string') {
    throw new TypeError('Model output must be a string');
  }
  let t = resultText.trim();
  if (t.startsWith('```json')) {
    t = t.replace(/```json/g, '').replace(/```/g, '').trim();
  } else if (t.startsWith('```')) {
    t = t.replace(/```/g, '').trim();
  }
  return JSON.parse(t);
}

module.exports = { parseModelJson };
