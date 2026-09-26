export function createTypingText(
  words: readonly string[],
  count = 120,
  random: () => number = Math.random,
): string {
  if (words.length === 0 || count <= 0) return "";
  const chosen: string[] = [];
  for (let index = 0; index < count; index++) {
    const wordIndex = Math.min(
      words.length - 1,
      Math.floor(random() * words.length),
    );
    chosen.push(words[wordIndex] ?? "type");
  }
  return chosen.join(" ");
}
