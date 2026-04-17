export type NormalizeFormat = "html" | "pdf" | "text";

export type MarkitdownExecutor = (input: {
  format: NormalizeFormat;
  payload: string | Buffer;
}) => Promise<string>;

export async function normalizeToMarkdown(
  input: {
    format: NormalizeFormat;
    payload: string | Buffer;
  },
  deps?: {
    exec?: MarkitdownExecutor;
  }
): Promise<string> {
  if (deps?.exec) {
    return textToMarkdown(await deps.exec(input));
  }

  switch (input.format) {
    case "html":
      return htmlToMarkdown(toUtf8(input.payload));
    case "text":
      return textToMarkdown(toUtf8(input.payload));
    case "pdf":
      return textToMarkdown(toUtf8(input.payload));
  }
}

function htmlToMarkdown(html: string): string {
  let s = html.replace(/\r\n?/g, "\n");

  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<(script|style|noscript|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(
    /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
    (_match, _quote, href: string, inner: string) =>
      `[${inlineText(inner)}](${decodeEntities(href.trim())})`
  );

  for (let level = 6; level >= 1; level -= 1) {
    const pattern = new RegExp(
      `<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`,
      "gi"
    );
    s = s.replace(pattern, (_match, inner: string) => {
      const text = inlineText(inner);
      return text ? `\n\n${"#".repeat(level)} ${text}\n\n` : "\n\n";
    });
  }

  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, inner: string) => {
    const text = inlineText(inner);
    return text ? `\n- ${text}` : "\n";
  });

  s = s.replace(
    /<(p|div|section|article|main|aside|header|footer|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_match, _tag: string, inner: string) => {
      const text = blockText(inner);
      return text ? `\n\n${text}\n\n` : "\n\n";
    }
  );

  s = s.replace(/<\/?(ul|ol|body|html)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");

  return textToMarkdown(s).replace(/[ \t]*\n- /g, "\n- ");
}

function inlineText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function blockText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textToMarkdown(text: string): string {
  return decodeEntities(text)
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function toUtf8(payload: string | Buffer): string {
  return Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
}
