// Pura-pura TTY supaya TUI full-screen aktif saat tes (dipasang lewat NODE_OPTIONS).
if (!process.stdout.isTTY) process.stdout.isTTY = true;
if (!process.stdin.isTTY) process.stdin.isTTY = true;
process.stdout.columns = 100;
process.stdout.rows = 32;
process.stdin.setRawMode = () => {};
