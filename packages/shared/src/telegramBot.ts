/**
 * A bot token pasted from BotFather, a Bot API URL or an `.env` file often
 * drags along whitespace, a trailing newline, wrapping quotes or the `bot`
 * prefix of `https://api.telegram.org/bot<token>/…`. None of that is part of
 * the token, and any of it makes every signature check fail with no hint why
 * — so it is removed. Returns `undefined` for an effectively empty value.
 */
export function normalizeBotToken(raw: string): string | undefined {
  let token = raw.trim();
  if (
    token.length >= 2 &&
    ((token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'")))
  ) {
    token = token.slice(1, -1).trim();
  }
  token = token.replace(/^bot(?=\d+:)/i, '');
  return token === '' ? undefined : token;
}
