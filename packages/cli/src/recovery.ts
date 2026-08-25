function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(previous[rightIndex]! + 1, current[rightIndex - 1]! + 1, substitution);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length]!;
}

export function closestCandidate(input: string, candidates: readonly string[], maxDistance = 2): string | undefined {
  let bestCandidate: string | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = editDistance(input, candidate);
    if (distance > maxDistance) continue;
    if (distance < bestDistance || (distance === bestDistance && (bestCandidate === undefined || candidate < bestCandidate))) {
      bestCandidate = candidate;
      bestDistance = distance;
    }
  }

  return bestCandidate;
}
