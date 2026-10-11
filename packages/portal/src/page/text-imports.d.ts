/**
 * `src/page/assets.ts` imports the page stylesheet and icon with `with { type: 'text' }`.
 * Bun's own declarations cover `*.txt` and `*.html` but not `*.css` or `*.svg`; these say
 * what the text loader gives. No other module in the repository imports either.
 */
declare module '*.css' {
  const text: string;
  export default text;
}

declare module '*.svg' {
  const text: string;
  export default text;
}
