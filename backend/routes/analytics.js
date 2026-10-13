import { Router } from 'express';
import { DeepAIChat } from '../ai.mjs';
import { computeInsights, ruleBasedSuggestions } from '../analyticsService.js';

const router = Router();

const NARRATIVE_SYSTEM_PROMPT = `
You are Stockroom's analytics narrator. You will be given ground-truth
business statistics computed directly from the database. Turn them into
5-8 short, specific, actionable business suggestions for a small retail
shop owner.

Rules:
- Use ONLY the numbers you are given — never invent figures.
- Be specific: name products, numbers, percentages.
- Use $ for all currency amounts, formatted like $1,200.00.
- No filler, no "Sure!", no generic advice not grounded in the data.
- Return STRICT JSON only: an array of strings, e.g. ["...", "..."]. No markdown fences, no other text.
`;

// Returns { suggestions, aiGenerated } — aiGenerated is only true when the
// model actually returned a usable array, not just when the HTTP call
// didn't throw (the underlying provider can "succeed" with a non-JSON
// response, e.g. an HTML error page, and that must not be reported as AI
// output).
async function generateNarrativeSuggestions(insights, fallback) {
  const chat = new DeepAIChat({ systemPrompt: NARRATIVE_SYSTEM_PROMPT, maxHistory: 2 });
  try {
    const raw = await chat.sendMessage(
      `BUSINESS STATS:\n${JSON.stringify(insights)}\n\nReturn the JSON array of suggestions.`
    );
    const cleaned = String(raw || '').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    let arr;
    try {
      arr = JSON.parse(cleaned);
    } catch {
      const first = cleaned.indexOf('[');
      const last = cleaned.lastIndexOf(']');
      if (first !== -1 && last > first) {
        try {
          arr = JSON.parse(cleaned.slice(first, last + 1));
        } catch { /* not usable */ }
      }
    }

    const suggestions = Array.isArray(arr)
      ? arr.filter((s) => typeof s === 'string' && s.trim()).slice(0, 8)
      : null;

    return suggestions?.length
      ? { suggestions, aiGenerated: true }
      : { suggestions: fallback, aiGenerated: false };
  } finally {
    await chat.close().catch(() => {});
  }
}

// GET /api/analytics/insights
// Rule-based stats are always computed straight from SQL (see
// analyticsService.js) — the AI call only rephrases them into a narrative.
// If the AI call fails (the underlying provider is not a reliable API),
// we fall back to the rule-based suggestions so the page never breaks.
router.get('/insights', async (req, res) => {
  const insights = await computeInsights(req.user.id);
  const fallback = ruleBasedSuggestions(insights);

  let suggestions = fallback;
  let aiGenerated = false;
  try {
    ({ suggestions, aiGenerated } = await generateNarrativeSuggestions(insights, fallback));
  } catch (err) {
    console.error('AI narrative generation failed, using rule-based suggestions:', err.message);
  }

  res.json({ ...insights, suggestions, aiGenerated });
});

export default router;
