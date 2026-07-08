// Original (high CRAP, uncovered branches)
function parseInput(input) {
  if (!input) throw new Error("No input");
  if (input.type === 'A') {
    return { value: input.data * 2 };
  } else if (input.type === 'B') {
    return { value: input.data / 2 };
  } else {
    return { value: 0 }; // Uncovered branch
  }
}

// Updated (reduced CRAP, covered branches)
function parseInput(input) {
  if (!input) {
    throw new Error("Input is required");
  }

  const multipliers = { A: 2, B: 0.5 };
  const multiplier = multipliers[input.type] || 1;
  return { value: input.data * multiplier };
}
