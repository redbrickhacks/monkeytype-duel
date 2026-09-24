export type TypingStats = {
  cursorIndex: number;
  correctChars: number;
  incorrectChars: number;
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
};

export class TypingSession {
  readonly typed: string[] = [];
  private samples: number[] = [];
  constructor(
    readonly text: string,
    readonly startedAt: number,
  ) {}

  input(key: string, now = Date.now()): TypingStats {
    if (key === "Backspace") {
      this.typed.pop();
    } else if (key.length === 1 && this.typed.length < this.text.length) {
      this.typed.push(key);
    }
    const stats = this.stats(now);
    if (key !== "Backspace") this.samples.push(stats.wpm);
    return stats;
  }

  stats(now = Date.now()): TypingStats {
    let correctChars = 0;
    for (let index = 0; index < this.typed.length; index++) {
      if (this.typed[index] === this.text[index]) correctChars++;
    }
    const incorrectChars = this.typed.length - correctChars;
    const minutes = Math.max((now - this.startedAt) / 60_000, 1 / 60);
    const wpm = correctChars / 5 / minutes;
    const raw = this.typed.length / 5 / minutes;
    const accuracy = this.typed.length
      ? (correctChars / this.typed.length) * 100
      : 100;
    const mean = this.samples.length
      ? this.samples.reduce((sum, value) => sum + value, 0) /
        this.samples.length
      : wpm;
    const deviation = this.samples.length
      ? Math.sqrt(
          this.samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
            this.samples.length,
        )
      : 0;
    const consistency =
      mean > 0 ? Math.max(0, 100 - (deviation / mean) * 100) : 100;
    return {
      cursorIndex: this.typed.length,
      correctChars,
      incorrectChars,
      wpm,
      raw,
      accuracy,
      consistency,
    };
  }
}
