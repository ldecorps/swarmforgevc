function parseCount(s) {
  const n = Number(s);
  if (Number.isNaN(n)) {
    throw new Error('not a number');
  }
  return n;
}

module.exports = { parseCount };
