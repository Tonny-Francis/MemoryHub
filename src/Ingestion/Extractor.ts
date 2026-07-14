import Anthropic from '@anthropic-ai/sdk';

import { env } from '../Config/Env.Config.js';
import type { IngestItem } from './types.js';

const DECISION_KEYWORDS = ['decided', 'decision', 'adr', 'architecture', 'we will', 'going with', 'chosen', 'adopted', 'rejected'];

function looksLikeDecision(item: IngestItem): boolean {
  const text = `${item.title} ${item.body}`.toLowerCase();
  return DECISION_KEYWORDS.some((kw) => text.includes(kw));
}

function formatRawDraft(item: IngestItem): string {
  const date = item.createdAt.slice(0, 10);
  const lines = [
    `# Draft: ${item.title}`,
    '',
    `**Source:** ${item.source}${item.url ? ` — [link](${item.url})` : ''}`,
    `**Author:** ${item.author ?? 'unknown'}`,
    `**Date:** ${date}`,
    '',
    '---',
    '',
    item.body,
  ];
  return lines.join('\n');
}

const ADR_PROMPT = `You are an ADR (Architecture Decision Record) extractor.

Given raw content from a developer tool (GitLab MR, Discord message, Trello card), determine if it describes a technical or architectural decision.

If YES, format it as an ADR in Markdown:

# [Short title of the decision]

## Status
Proposed

## Context
[Why this decision was needed — extracted from the content]

## Decision
[What was decided — extracted from the content]

## Consequences
[What changes or implications follow from this decision]

## Source
[source type and URL if available]

If NO (the content is NOT about a technical/architectural decision), respond with exactly the word: NOT_A_DECISION`;

export async function extractAdr(item: IngestItem): Promise<string | null> {
  if (!looksLikeDecision(item)) return null;

  if (!env.ANTHROPIC_API_KEY) {
    return formatRawDraft(item);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const userContent = [
    `Source: ${item.source}`,
    `URL: ${item.url ?? 'N/A'}`,
    `Author: ${item.author ?? 'unknown'}`,
    `Title: ${item.title}`,
    '',
    item.body,
  ].join('\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      { role: 'user', content: `${ADR_PROMPT}\n\n---\n\n${userContent}` },
    ],
  });

  const text = message.content.find((b) => b.type === 'text')?.text?.trim() ?? '';
  if (!text || text === 'NOT_A_DECISION') return null;
  return text;
}
