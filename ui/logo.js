// Logo blok 3 baris. Disusun per huruf supaya spasi selalu pas.
const LETTERS = {
  B: ['█▀▀▄', '█▀▀▄', '▀▀▀ '],
  E: ['█▀▀▀', '█▀▀ ', '▀▀▀▀'],
  O: ['█▀▀█', '█  █', '▀▀▀▀'],
  T: ['▀▀█▀▀', '  █  ', '  ▀  '],
};

export const LOGO_WIDTH = 20;

// Di bawah lebar ini logo tidak dipakai (kolom terlalu sempit untuk meta).
export const LOGO_MIN_WIDTH = 44;

export function logoRows() {
  const chars = ['B', 'E', 'O', 'T'];
  return [0, 1, 2].map((row) => chars.map((ch) => LETTERS[ch][row]).join(' '));
}

// Versi besar untuk layar splash (5 baris, 30 kolom).
const BIG = {
  B: ['██████', '██  ██', '██████', '██  ██', '██████'],
  E: ['██████', '██    ', '█████ ', '██    ', '██████'],
  O: ['██████', '██  ██', '██  ██', '██  ██', '██████'],
  T: ['██████', '  ██  ', '  ██  ', '  ██  ', '  ██  '],
};

export const SPLASH_WIDTH = 30;

export function splashRows() {
  const chars = ['B', 'E', 'O', 'T'];
  return [0, 1, 2, 3, 4].map((row) => chars.map((ch) => BIG[ch][row]).join('  '));
}
