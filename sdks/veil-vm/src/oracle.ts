// ============================================================================
// @veil/vm-sdk — xAI Oracle
// Grok frontier service as centralized source of truth
// ============================================================================

import type { TruthQuery, TruthResponse } from './types.js';

const DEFAULT_XAI_ENDPOINT = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-3';

const SYSTEM_PROMPT = `You are the xAI Oracle for the VEIL network — a sovereign AI agent chain.

Your role: resolve prediction markets with deterministic, verifiable truth.

RULES:
1. Be precise. Your answer determines real economic outcomes.
2. Only use the evidence sources specified. If they're insufficient, return INVALID.
3. Apply the resolution criteria EXACTLY as written. Do not interpret loosely.
4. If the event hasn't occurred yet or evidence is ambiguous, return INVALID.
5. Your confidence score must reflect actual certainty, not opinion strength.
6. Include specific evidence (URLs, data points, timestamps) in your response.

RESPONSE FORMAT (JSON only):
{
  "outcome": "YES" | "NO" | "INVALID" | "<categorical_value>",
  "confidence": <0.0 to 1.0>,
  "evidence": ["<specific evidence point 1>", "<specific evidence point 2>"],
  "reasoning": "<clear explanation of determination>"
}`;

export class XaiOracle {
  private apiKey: string;
  private endpoint: string;
  private model: string;

  constructor(apiKey: string, endpoint?: string, model?: string) {
    this.apiKey = apiKey;
    this.endpoint = endpoint ?? DEFAULT_XAI_ENDPOINT;
    this.model = model ?? DEFAULT_MODEL;
  }

  /**
   * Query Grok for market truth resolution.
   *
   * The market creator defines the question and resolution criteria.
   * Grok evaluates against the specified evidence sources and returns
   * a deterministic judgment.
   *
   * Bad criteria = bad resolution = market creator's problem.
   * Natural selection handles the rest.
   */
  async query(query: TruthQuery): Promise<TruthResponse> {
    const userPrompt = this.buildPrompt(query);

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0, // Deterministic — same question should get same answer
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(`xAI Oracle error: ${response.status} ${response.statusText}`);
    }

    const json = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = json.choices[0]?.message?.content;
    if (!content) throw new Error('xAI Oracle returned empty response');

    const parsed = JSON.parse(content) as {
      outcome: string;
      confidence: number;
      evidence: string[];
      reasoning: string;
    };

    // Validate response structure
    this.validate(parsed);

    const timestamp = Date.now();
    const responseHash = await this.hash(content + timestamp);

    return {
      outcome: parsed.outcome.toLowerCase(),
      confidence: parsed.confidence,
      evidence: parsed.evidence,
      reasoning: parsed.reasoning,
      timestamp,
      responseHash,
    };
  }

  /**
   * Multi-query for consensus — multiple independent calls,
   * results must agree. Used when validators each query independently.
   */
  async queryWithConsensus(
    query: TruthQuery,
    requiredAgreement: number = 3,
  ): Promise<TruthResponse> {
    const results = await Promise.all(
      Array.from({ length: requiredAgreement }, () => this.query(query)),
    );

    // Check consensus — all outcomes must match
    const outcomes = results.map((r) => r.outcome);
    const majority = outcomes.sort(
      (a, b) =>
        outcomes.filter((o) => o === b).length -
        outcomes.filter((o) => o === a).length,
    )[0];

    const agreeing = results.filter((r) => r.outcome === majority);

    if (agreeing.length < requiredAgreement) {
      // No consensus — return invalid
      return {
        outcome: 'invalid',
        confidence: 0,
        evidence: [`No consensus: ${outcomes.join(', ')}`],
        reasoning: `Oracle consensus failed. ${agreeing.length}/${requiredAgreement} agreed on "${majority}".`,
        timestamp: Date.now(),
        responseHash: await this.hash('no-consensus-' + Date.now()),
      };
    }

    // Return highest confidence agreeing result
    return agreeing.sort((a, b) => b.confidence - a.confidence)[0]!;
  }

  private buildPrompt(query: TruthQuery): string {
    let prompt = `Resolve this prediction market:\n\n`;
    prompt += `QUESTION: ${query.question}\n\n`;
    prompt += `RESOLUTION CRITERIA: ${query.resolutionCriteria}\n\n`;
    prompt += `RESOLUTION TYPE: ${query.resolutionType}\n\n`;

    if (query.evidenceSources.length > 0) {
      prompt += `EVIDENCE SOURCES (check these):\n`;
      for (const source of query.evidenceSources) {
        prompt += `- ${source}\n`;
      }
    }

    prompt += `\nCurrent UTC time: ${new Date().toISOString()}\n`;
    prompt += `\nRespond with JSON only.`;

    return prompt;
  }

  private validate(parsed: Record<string, unknown>): void {
    if (!parsed.outcome || typeof parsed.outcome !== 'string') {
      throw new Error('xAI Oracle: missing or invalid outcome');
    }
    if (typeof parsed.confidence !== 'number' || parsed.confidence < 0 || parsed.confidence > 1) {
      throw new Error('xAI Oracle: confidence must be 0.0-1.0');
    }
    if (!Array.isArray(parsed.evidence)) {
      throw new Error('xAI Oracle: evidence must be an array');
    }
    if (!parsed.reasoning || typeof parsed.reasoning !== 'string') {
      throw new Error('xAI Oracle: missing reasoning');
    }
  }

  private async hash(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);

    // Use Web Crypto API (works in Node 18+ and browsers)
    if (typeof globalThis.crypto?.subtle !== 'undefined') {
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return '0x' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    // Fallback: Node.js crypto
    const { createHash } = await import('node:crypto');
    return '0x' + createHash('sha256').update(input).digest('hex');
  }
}
