// plain-md: markdown files carry no bold or italic. Only the text a Write or
// Edit adds is read, with code fences and inline code left out.
const MD_FILE = /\.md$/i;
const FENCE = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;
const EMPHASIS = [
  /\*\*(?=\S)[^\n]*?\S\*\*/,
  /__(?=\S)[^\n]*?\S__/,
  /(?<![\w*\\])\*[^\s*](?:[^*\n]*[^\s*])?\*(?![\w*])/,
  /(?<![\w\\/])_[^\s_](?:[^_\n]*[^\s_])?_(?![\w])/,
];
export const MD_REASON =
  "Markdown files carry no bold or italic here: write the text plain, and use a heading, " +
  "a list or `code` where the emphasis was.";

export const hasEmphasis = (text: string) => {
  const prose = text.replace(FENCE, "").replace(INLINE_CODE, "");
  return EMPHASIS.some((re) => re.test(prose));
};

export const breaksPlainMd = (path: string, text: string) =>
  MD_FILE.test(path) && hasEmphasis(text);
