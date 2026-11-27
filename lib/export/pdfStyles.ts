// Print stylesheet for PDF export — mirrors the note styles on the web page, in jf open 粉圓 2.1 at 14pt.
export const PDF_CSS = `
@font-face {
  font-family: "jf-openhuninn";
  src: url("/fonts/jf-openhuninn-2.1.ttf") format("truetype");
  font-display: block;
}
@page { size: A4; margin: 18mm 18mm 20mm; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0; color: #15171c; background: #fff;
  font-family: "jf-openhuninn", "jf open 粉圓 2.1", sans-serif;
  font-size: 14pt; overflow-wrap: anywhere;
  /* line spacing = Word 最小行高 0 pt: each line is as tall as the font needs */
  line-height: normal;
}

/* document header */
.doc-head { margin: 0 0 22pt; padding-bottom: 12pt; border-bottom: 1.5pt solid #c7a571; }
.doc-head p { margin: 0; }
.doc-head .eyebrow { font-size: 10pt; letter-spacing: .3em; color: #a98450; }
.doc-head .doc-title { font-size: 26pt; font-weight: 700; color: #0f1a2b; line-height: normal; margin: 4pt 0; }
.doc-head .meta { font-size: 10pt; color: #9b9da4; letter-spacing: .04em; }

/* category headings */
.sec-1 + .sec-1 { break-before: page; }
.cat { color: #0f1a2b; font-weight: 700; line-height: normal; letter-spacing: .03em; break-after: avoid; }
.cat-1 { font-size: 24pt; margin: 0 0 14pt; padding-bottom: 8pt; border-bottom: 1.5pt solid #c7a571; }
.cat-1 .num { color: #a98450; }
.cat-2 { font-size: 19pt; margin: 24pt 0 10pt; padding-left: 10pt; border-left: 4pt solid #a98450; }
.cat-3 { font-size: 16pt; margin: 20pt 0 8pt; color: #1c2a40; }
.note { margin: 0 0 8pt; }

/* note content (same as .page-body on the web) */
.note > :first-child { margin-top: 0; }
.note p { margin: 0 0 .8em; }
.note h2 { font-size: 1.5em; font-weight: 700; color: #0f1a2b; margin: 1.3em 0 .6em; padding-bottom: 6pt; border-bottom: 1px solid #e8e3da; letter-spacing: .03em; line-height: normal; break-after: avoid; }
.note h3 { font-size: 1.2em; font-weight: 700; color: #0f1a2b; margin: 1.1em 0 .4em; padding-left: 10pt; border-left: 3pt solid #a98450; line-height: normal; break-after: avoid; }
.note h4 { font-size: 1.02em; font-weight: 700; margin: .9em 0 .3em; break-after: avoid; }
.note blockquote { margin: 1.2em 0; padding: 10pt 16pt; border-left: 2pt solid #a98450; background: #faf8f5; color: #565b66; }
.note ul, .note ol { padding-left: 1.6em; margin: 0 0 .9em; }
.note ul { list-style: disc; }
.note ol { list-style: decimal; }
.note li { margin: .2em 0; }
.note li::marker { color: #a98450; }
.note hr { border: 0; height: 1px; background: #c7a571; margin: 1.6em 0; }
.note a { color: #0f1a2b; text-decoration: underline; text-decoration-color: #a98450; }
.note mark { background: #fdf0b8; color: inherit; padding: 0 2px; border-radius: 2px; }
.note code, .note pre { font-size: .88em; background: #faf8f5; border: 1px solid #e8e3da; border-radius: 4px; padding: 0 5px; }
.note pre { padding: 10pt 14pt; white-space: pre-wrap; }
.note table { width: 100%; border-collapse: collapse; margin: 1.2em 0; font-size: .95em; }
.note tr { break-inside: avoid; }
.note td, .note th { border: 1px solid #d6cfc2; padding: 6pt 9pt; vertical-align: top; }
.note td > :last-child, .note th > :last-child { margin-bottom: 0; }
.note th { background: #0f1a2b; color: #fff; font-weight: 500; letter-spacing: .06em; }
.note tr:nth-child(even) td { background: #faf8f5; }
.note img { display: block; max-width: 100%; height: auto; margin: 12pt 0; border: 1px solid #e8e3da; border-radius: 4px; padding: 3px; background: #fff; break-inside: avoid; }
.note [style*="text-align: center"] img { margin-left: auto; margin-right: auto; }
.note [style*="text-align: right"] img { margin-left: auto; }
`;
