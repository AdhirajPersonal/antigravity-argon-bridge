/**
 * Token estimation utility for calculating heuristic token counts
 * across input prompts, code blocks, and model responses.
 */

export class TokenCounter {
  /**
   * Estimates token count for a given text.
   * Standard LLM tokenization averages ~4 chars per token for natural language,
   * and ~3 chars per token for dense source code or formatting.
   */
  static estimate(text: string): number {
    if (!text || text.length === 0) return 0;

    // Detect code blocks (``` ... ```)
    const codeBlockRegex = /```[\s\S]*?```/g;
    let codeChars = 0;
    const codeMatches = text.match(codeBlockRegex);
    if (codeMatches) {
      for (const match of codeMatches) {
        codeChars += match.length;
      }
    }

    const naturalChars = Math.max(0, text.length - codeChars);

    // Code: ~3.0 chars per token
    const codeTokens = Math.ceil(codeChars / 3.0);
    // Natural language: ~3.8 chars per token
    const naturalTokens = Math.ceil(naturalChars / 3.8);

    return Math.max(1, codeTokens + naturalTokens);
  }

  /**
   * Estimates input tokens combining prompt and optional context
   */
  static estimateInput(prompt: string, context?: string): number {
    const combined = context ? `${context}\n\n${prompt}` : prompt;
    return this.estimate(combined);
  }

  /**
   * Estimates output tokens from the model response
   */
  static estimateOutput(response: string): number {
    return this.estimate(response);
  }
}
