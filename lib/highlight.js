// Syntax highlighting ringan tanpa dependensi: keyword, string, angka, komentar, nama fungsi.
import { c } from '../ui/theme.js';

const LIST = {
  js: 'const let var function return if else for while do switch case break continue new class extends super this import export from default async await try catch finally throw typeof instanceof in of void yield delete static get set',
  ts: 'interface type enum namespace implements readonly public private protected declare as satisfies keyof',
  python: 'def class return if elif else for while import from as try except finally raise with yield lambda pass break continue global nonlocal assert del not and or in is None True False async await match',
  bash: 'if then else elif fi for while do done case esac function in local export return echo set unset read cd source alias',
  solidity: 'pragma solidity contract interface library function modifier event emit returns return if else for while do break continue mapping address uint uint256 int int256 string bool bytes memory storage calldata public private internal external view pure payable constructor receive fallback require revert assert import is using new delete true false this super struct enum indexed anonymous virtual override immutable constant',
  go: 'package import func var const type struct interface map chan go defer select case default if else for range return break continue switch fallthrough nil true false',
  rust: 'fn let mut pub use mod struct enum impl trait for while loop match if else return self Self as const static async await move ref dyn where unsafe extern crate super',
  json: 'true false null',
};

const HASH_COMMENT = new Set(['python', 'bash', 'yaml', 'yml', 'ruby', 'toml', 'ini']);

function normalize(lang) {
  const s = String(lang || '').toLowerCase().split(/[\s:]/)[0];
  if (s === 'jsx') return 'js';
  if (s === 'tsx') return 'ts';
  if (s === 'sh' || s === 'shell' || s === 'zsh') return 'bash';
  if (s === 'sol') return 'solidity';
  if (s === 'py') return 'python';
  if (s === 'golang') return 'go';
  if (s === 'yml') return 'yaml';
  if (s === 'rb') return 'ruby';
  return (LIST[s] || HASH_COMMENT.has(s)) ? s : 'js';
}

function words(s) {
  return new Set(s.split(/\s+/).filter(Boolean));
}

const KEYWORDS = Object.fromEntries(Object.entries(LIST).map(([k, v]) => [k, words(v)]));
KEYWORDS.ts = new Set([...KEYWORDS.js, ...KEYWORDS.ts]);

const isWordStart = (ch) => /[A-Za-z_$]/.test(ch);
const isWord = (ch) => /[A-Za-z0-9_$]/.test(ch);
const isDigit = (ch) => ch >= '0' && ch <= '9';

export function highlight(text, lang = '') {
  const l = normalize(lang);
  const kw = KEYWORDS[l] || KEYWORDS.js;
  const hash = HASH_COMMENT.has(l);
  const src = String(text);
  let out = '';
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (!hash && src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      out += c.cmt(end === -1 ? src.slice(i) : src.slice(i, end));
      if (end === -1) break;
      i = end;
      continue;
    }
    if (!hash && src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += c.cmt(src.slice(i, stop));
      i = stop;
      continue;
    }
    if (hash && ch === '#' && (i === 0 || /\s/.test(src[i - 1]))) {
      const end = src.indexOf('\n', i);
      out += c.cmt(end === -1 ? src.slice(i) : src.slice(i, end));
      if (end === -1) break;
      i = end;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === ch) { j++; break; }
        j++;
      }
      out += c.str(src.slice(i, j));
      i = j;
      continue;
    }

    if (isDigit(ch) && (i === 0 || !isWord(src[i - 1]))) {
      let j = i;
      while (j < src.length && /[0-9a-fA-FxX._]/.test(src[j])) j++;
      out += c.num(src.slice(i, j));
      i = j;
      continue;
    }

    if (isWordStart(ch)) {
      let j = i + 1;
      while (j < src.length && isWord(src[j])) j++;
      const word = src.slice(i, j);
      if (kw.has(word)) {
        out += c.kw(word);
      } else {
        let k = j;
        while (k < src.length && src[k] === ' ') k++;
        if (src[k] === '(') out += c.fn(word);
        else if (/^[A-Z]/.test(word)) out += c.type(word);
        else out += word;
      }
      i = j;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}
