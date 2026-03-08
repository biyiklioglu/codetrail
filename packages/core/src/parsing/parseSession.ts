import { canonicalMessageSchema } from "../contracts/canonical";

import {
  type ParseSessionInput,
  type ParseSessionResult,
  type ParserDiagnostic,
  parseSessionInputSchema,
  parseSessionResultSchema,
} from "./contracts";
import {
  type ParseProviderEventResult,
  parseProviderEvent,
  parseProviderPayload,
} from "./providerParsers";

// parseSession is the narrow boundary between provider-specific transcript shapes and the
// canonical message model used everywhere else in the app.
export function parseSession(input: ParseSessionInput): ParseSessionResult {
  const validated = parseSessionInputSchema.parse(input);
  const diagnostics: ParserDiagnostic[] = [];
  const messages = normalizeParsedMessages(
    validated.provider,
    validated.sessionId,
    diagnostics,
    parseProviderPayload({
      provider: validated.provider,
      sessionId: validated.sessionId,
      payload: validated.payload,
      diagnostics,
    }),
  );

  if (messages.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "parser.no_events_found",
      provider: validated.provider,
      sessionId: validated.sessionId,
      eventIndex: null,
      message: "No events were discovered in payload; returning empty message list.",
    });
  }

  return parseSessionResultSchema.parse({
    messages,
    diagnostics,
  });
}

export function parseSessionEvent(args: {
  provider: ParseSessionInput["provider"];
  sessionId: ParseSessionInput["sessionId"];
  eventIndex: number;
  event: unknown;
  diagnostics: ParserDiagnostic[];
  sequence: number;
}): {
  messages: ParseSessionResult["messages"];
  nextSequence: number;
} {
  const validated = parseSessionInputSchema.parse({
    provider: args.provider,
    sessionId: args.sessionId,
    payload: null,
  });
  const parsed = parseProviderEvent({
    provider: validated.provider,
    sessionId: validated.sessionId,
    eventIndex: args.eventIndex,
    event: args.event,
    diagnostics: args.diagnostics,
    sequence: args.sequence,
  });

  return {
    messages: normalizeParsedMessages(
      validated.provider,
      validated.sessionId,
      args.diagnostics,
      parsed.messages,
    ),
    nextSequence: parsed.nextSequence,
  };
}

function normalizeParsedMessages(
  provider: ParseSessionInput["provider"],
  sessionId: ParseSessionInput["sessionId"],
  diagnostics: ParserDiagnostic[],
  messages: ReturnType<typeof parseProviderPayload>,
): ParseSessionResult["messages"] {
  return messages.map((message) => {
    const candidate = {
      id: message.id,
      sessionId,
      provider,
      category: message.category,
      content: message.content,
      createdAt: message.createdAt,
      tokenInput: message.tokenInput,
      tokenOutput: message.tokenOutput,
      operationDurationMs: message.operationDurationMs ?? null,
      operationDurationSource: message.operationDurationSource ?? null,
      operationDurationConfidence: message.operationDurationConfidence ?? null,
    };

    // Provider parsers are intentionally permissive. Canonical validation catches anything that
    // still does not satisfy the shared contract before it reaches indexing/search.
    const parsedMessage = canonicalMessageSchema.safeParse(candidate);
    if (!parsedMessage.success) {
      diagnostics.push({
        severity: "error",
        code: "parser.invalid_canonical_message",
        provider,
        sessionId,
        eventIndex: null,
        message: `Failed canonical validation: ${parsedMessage.error.message}`,
      });

      return {
        ...candidate,
        content: String(candidate.content),
      };
    }

    return parsedMessage.data;
  });
}
