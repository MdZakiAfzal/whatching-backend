import axios from 'axios';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import mongoose from 'mongoose';
import KnowledgeSource from '../models/KnowledgeSource';
import KnowledgeChunk from '../models/KnowledgeChunk';

const normalizeKnowledgeText = (input: string) =>
  input
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

const chunkText = (text: string, chunkSize: number = 1200, overlap: number = 200) => {
  const normalized = normalizeKnowledgeText(text);
  if (!normalized) return [];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const next = normalized.slice(cursor, cursor + chunkSize);
    if (next.trim()) {
      chunks.push(next.trim());
    }
    cursor += Math.max(1, chunkSize - overlap);
  }

  return chunks;
};

const extractFaqText = (
  entries: Array<{ question: string; answer: string }> | undefined
) => {
  if (!entries?.length) return '';

  return entries
    .map((entry) => `Question: ${entry.question}\nAnswer: ${entry.answer}`)
    .join('\n\n');
};

const downloadSourceFile = async (url: string) => {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
  });

  return Buffer.from(response.data);
};

const extractTextFromBuffer = async (buffer: Buffer, mimeType?: string, filename?: string) => {
  const normalizedMime = String(mimeType || '').toLowerCase();
  const normalizedName = String(filename || '').toLowerCase();

  if (normalizedMime === 'text/plain' || normalizedName.endsWith('.txt')) {
    return buffer.toString('utf8');
  }

  if (
    normalizedMime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    normalizedName.endsWith('.docx')
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (normalizedMime === 'application/pdf' || normalizedName.endsWith('.pdf')) {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }

  throw new Error('Unsupported knowledge file type.');
};

export const createKnowledgeChunksForSource = async (
  sourceId: mongoose.Types.ObjectId | string
) => {
  const source = await KnowledgeSource.findById(sourceId);
  if (!source) {
    throw new Error('Knowledge source not found.');
  }

  source.status = 'processing';
  source.ingestError = undefined;
  await source.save();

  try {
    let rawText = '';

    if (source.type === 'text') {
      rawText = source.content || '';
    } else if (source.type === 'faq') {
      rawText = extractFaqText(source.faqEntries);
    } else if (source.type === 'file') {
      if (!source.cloudinaryUrl) {
        throw new Error('Missing uploaded file URL for knowledge source.');
      }
      const buffer = await downloadSourceFile(source.cloudinaryUrl);
      rawText = await extractTextFromBuffer(buffer, source.mimeType, source.filename);
    }

    rawText = normalizeKnowledgeText(rawText);
    if (!rawText) {
      throw new Error('No extractable text found in knowledge source.');
    }

    const chunks = chunkText(rawText);
    if (!chunks.length) {
      throw new Error('Knowledge source could not be chunked.');
    }

    await KnowledgeChunk.deleteMany({ sourceId: source._id });

    await KnowledgeChunk.insertMany(
      chunks.map((chunk, index) => ({
        orgId: source.orgId,
        sourceId: source._id,
        order: index,
        content: chunk,
        normalizedContent: chunk.toLowerCase(),
      }))
    );

    source.status = 'ready';
    source.chunkCount = chunks.length;
    source.lastIngestedAt = new Date();
    await source.save();
  } catch (error: any) {
    source.status = 'failed';
    source.ingestError = error.message || 'Knowledge ingestion failed.';
    source.chunkCount = 0;
    await source.save();
    throw error;
  }
};

export const retrieveKnowledgeChunks = async ({
  orgId,
  query,
  limit = 5,
}: {
  orgId: mongoose.Types.ObjectId | string;
  query: string;
  limit?: number;
}) => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const textMatches = await KnowledgeChunk.find(
    {
      orgId,
      $text: { $search: normalizedQuery },
    },
    {
      score: { $meta: 'textScore' },
    }
  )
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .select('content sourceId');

  if (textMatches.length > 0) {
    return textMatches.map((chunk) => ({
      id: String(chunk._id),
      sourceId: String(chunk.sourceId),
      content: chunk.content,
    }));
  }

  const fallbackRegex = new RegExp(
    normalizedQuery
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join('|'),
    'i'
  );

  const fallbackMatches = await KnowledgeChunk.find({
    orgId,
    content: fallbackRegex,
  })
    .limit(limit)
    .select('content sourceId');

  return fallbackMatches.map((chunk) => ({
    id: String(chunk._id),
    sourceId: String(chunk.sourceId),
    content: chunk.content,
  }));
};
