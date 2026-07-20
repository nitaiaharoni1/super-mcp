import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "@super-mcp/shared";
import type {
  BasketAnswer,
  BasketContinuationV1,
  BasketInitialInput,
} from "./types.js";

const TOKEN_TTL_MS = 30 * 60 * 1000;

export function assertBasketContinuationSecret(secret: string): void {
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BASKET_CONTINUATION_SECRET must contain at least 32 bytes");
  }
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

export function createBasketContinuationPayload(
  input: BasketContinuationV1["input"],
  questions: BasketContinuationV1["questions"],
  now = Date.now(),
): BasketContinuationV1 {
  return { version: 1, issuedAt: now, expiresAt: now + TOKEN_TTL_MS, input, questions };
}

export function encodeBasketContinuation(
  payload: BasketContinuationV1,
  secret: string,
): string {
  assertBasketContinuationSecret(secret);
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = signature(body, secret).toString("base64url");
  return `${body}.${mac}`;
}

export function decodeBasketContinuation(
  token: string,
  secret: string,
  now = Date.now(),
): BasketContinuationV1 {
  assertBasketContinuationSecret(secret);
  const [body, suppliedMac, extra] = token.split(".");
  if (!body || !suppliedMac || extra) {
    throw new AppError("invalid_basket_continuation", "invalid basket continuation", 400);
  }
  const expected = signature(body, secret);
  const supplied = Buffer.from(suppliedMac, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new AppError("invalid_basket_continuation", "invalid basket continuation", 400);
  }
  let parsed: BasketContinuationV1;
  try {
    parsed = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as BasketContinuationV1;
  } catch {
    throw new AppError("invalid_basket_continuation", "invalid basket continuation", 400);
  }
  if (parsed.version !== 1) {
    throw new AppError(
      "unsupported_basket_continuation",
      "unsupported basket continuation version",
      400,
    );
  }
  if (parsed.expiresAt < now) {
    throw new AppError("basket_continuation_expired", "basket continuation expired", 400);
  }
  return parsed;
}

/**
 * Apply confirmed option answers onto the original initial input. Preserves the
 * free-text query and quantity fields; sets intentModeOverride from selectionEffect.
 */
export function applyBasketAnswers(
  payload: BasketContinuationV1,
  answers: BasketAnswer[],
): BasketInitialInput {
  const answersByIndex = new Map<number, BasketAnswer>();
  for (const answer of answers) {
    if (answersByIndex.has(answer.itemIndex)) {
      throw new AppError(
        "invalid_basket_answer",
        `duplicate answer for item ${answer.itemIndex}`,
        400,
      );
    }
    answersByIndex.set(answer.itemIndex, answer);
  }
  for (const question of payload.questions) {
    const answer = answersByIndex.get(question.itemIndex);
    if (!answer) {
      throw new AppError(
        "missing_basket_answer",
        `missing required answer for item ${question.itemIndex}`,
        400,
      );
    }
    if (!question.allowedProductIds.includes(answer.productId)) {
      throw new AppError(
        "invalid_basket_answer",
        `product was not offered for item ${question.itemIndex}`,
        400,
      );
    }
  }
  if (answersByIndex.size !== payload.questions.length) {
    throw new AppError(
      "invalid_basket_answer",
      "answer references an unknown item index",
      400,
    );
  }
  const questionByIndex = new Map(
    payload.questions.map((question) => [question.itemIndex, question]),
  );
  return {
    ...payload.input,
    items: payload.input.items.map((item, itemIndex) => {
      const question = questionByIndex.get(itemIndex);
      const answer = answersByIndex.get(itemIndex);
      if (!question || !answer) return item;
      return {
        ...item,
        productId: answer.productId,
        gtin: undefined,
        intentModeOverride: question.selectionEffect === "pin" ? "exact" : "commodity",
      };
    }),
  };
}
