export type TypingStats = {
  cursorIndex: number;
  correctChars: number;
  incorrectChars: number;
  wpm: number;
  raw: number;
  accuracy: number;
  consistency: number;
};

export type TypingWordState = {
  target: string;
  input: string;
  committed: boolean;
};

export type TypingAction = string | "Backspace" | "DeleteWord";

const MAX_EXTRA_LETTERS = 20;

/**
 * A compact adaptation of Monkeytype's current-input + word-history model.
 * Space commits one word and starts the next, so mistakes never shift the
 * alignment of every character that follows.
 */
export class TypingSession {
  readonly targets: readonly string[];
  private readonly inputs: string[];
  private readonly committed: boolean[];
  private readonly offsets: number[];
  private samples: number[] = [];
  private activeWordIndex = 0;

  constructor(
    readonly text: string,
    readonly startedAt: number,
  ) {
    this.targets = text.split(" ");
    this.inputs = this.targets.map(() => "");
    this.committed = this.targets.map(() => false);
    this.offsets = [];
    let offset = 0;
    for (const target of this.targets) {
      this.offsets.push(offset);
      offset += target.length + 1;
    }
  }

  input(action: TypingAction, now = Date.now()): TypingStats {
    if (action === "DeleteWord") {
      this.deleteWord();
    } else if (action === "Backspace") {
      this.backspace();
    } else if (action === " ") {
      this.commitWord();
    } else if (action.length === 1) {
      const target = this.targets[this.activeWordIndex] ?? "";
      const current = this.inputs[this.activeWordIndex] ?? "";
      if (current.length < target.length + MAX_EXTRA_LETTERS) {
        this.inputs[this.activeWordIndex] = current + action;
      }
    }

    const stats = this.stats(now);
    if (action !== "Backspace" && action !== "DeleteWord") {
      this.samples.push(stats.wpm);
    }
    return stats;
  }

  wordStates(): readonly TypingWordState[] {
    return this.targets.map((target, index) => ({
      target,
      input: this.inputs[index] ?? "",
      committed: this.committed[index] ?? false,
    }));
  }

  stats(now = Date.now()): TypingStats {
    let correctWordChars = 0;
    let correctSpaces = 0;
    let correctInputChars = 0;
    let incorrectInputChars = 0;
    let missedChars = 0;
    let rawChars = 0;

    for (let index = 0; index <= this.activeWordIndex; index++) {
      const target = this.targets[index] ?? "";
      const input = this.inputs[index] ?? "";
      const isCommitted = this.committed[index] ?? false;
      const wordIsCorrect = input === target;

      rawChars += input.length;
      for (let character = 0; character < input.length; character++) {
        if (input[character] === target[character]) correctInputChars++;
        else incorrectInputChars++;
      }

      if (isCommitted) {
        rawChars++;
        if (wordIsCorrect) {
          correctWordChars += target.length;
          correctSpaces++;
          correctInputChars++;
        } else {
          incorrectInputChars++;
          missedChars += Math.max(0, target.length - input.length);
        }
      } else if (wordIsCorrect || target.startsWith(input)) {
        // Monkeytype gives live credit for the correct prefix of the active
        // word, but an error makes that word contribute zero adjusted WPM.
        correctWordChars += input.length;
      }
    }

    const correctChars = correctWordChars + correctSpaces;
    const incorrectChars = incorrectInputChars + missedChars;
    const minutes = Math.max((now - this.startedAt) / 60_000, 1 / 60);
    const wpm = correctChars / 5 / minutes;
    const raw = rawChars / 5 / minutes;
    const accuracyDenominator = correctInputChars + incorrectInputChars;
    const accuracy = accuracyDenominator
      ? (correctInputChars / accuracyDenominator) * 100
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
      cursorIndex: this.cursorIndex(),
      correctChars,
      incorrectChars,
      wpm,
      raw,
      accuracy,
      consistency,
    };
  }

  private cursorIndex(): number {
    const target = this.targets[this.activeWordIndex] ?? "";
    const input = this.inputs[this.activeWordIndex] ?? "";
    return (
      (this.offsets[this.activeWordIndex] ?? this.text.length) +
      Math.min(input.length, target.length)
    );
  }

  private commitWord(): void {
    const input = this.inputs[this.activeWordIndex] ?? "";
    if (input.length === 0 || this.committed[this.activeWordIndex]) return;
    this.committed[this.activeWordIndex] = true;
    if (this.activeWordIndex < this.targets.length - 1) {
      this.activeWordIndex++;
    }
  }

  private backspace(): void {
    const input = this.inputs[this.activeWordIndex] ?? "";
    if (input.length > 0) {
      this.inputs[this.activeWordIndex] = input.slice(0, -1);
      return;
    }
    this.reopenPreviousIncorrectWord(false);
  }

  private deleteWord(): void {
    const input = this.inputs[this.activeWordIndex] ?? "";
    if (input.length > 0) {
      this.inputs[this.activeWordIndex] = "";
      return;
    }
    this.reopenPreviousIncorrectWord(true);
  }

  private reopenPreviousIncorrectWord(clear: boolean): void {
    if (this.activeWordIndex === 0) return;
    const previousIndex = this.activeWordIndex - 1;
    const previousInput = this.inputs[previousIndex] ?? "";
    const previousTarget = this.targets[previousIndex] ?? "";
    if (previousInput === previousTarget) return;
    this.activeWordIndex = previousIndex;
    this.committed[previousIndex] = false;
    if (clear) this.inputs[previousIndex] = "";
  }
}
