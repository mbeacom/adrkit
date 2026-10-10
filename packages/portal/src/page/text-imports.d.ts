/**
 * `src/page/assets.ts` imports the page stylesheet with `with { type: 'text' }`. Bun's own
 * declarations cover `*.txt` and `*.html` but not `*.css`; this one says what the text loader
 * gives. No other module in the repository imports a stylesheet.
 */
declare module '*.css' {
  const text: string;
  export default text;
}
