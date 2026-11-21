import { streamChat } from './ollama.mjs';

// 检测末尾是否由同一单元连续重复（模型陷入重复循环的特征），支持不同长度的重复单元。
export function isRepetitiveLoop(text, { minRepeats = 3 } = {}) {
  const tail = String(text).slice(-600);
  for (let unitLen = 10; unitLen <= 150; unitLen += 1) {
    if (tail.length < unitLen * minRepeats) continue;
    const unit = tail.slice(-unitLen);
    let count = 0;
    let pos = tail.length;
    while (pos - unitLen >= 0 && tail.slice(pos - unitLen, pos) === unit) {
      count += 1;
      pos -= unitLen;
    }
    if (count >= minRepeats) return true;
  }
  return false;
}

// 生成直到自然结束：被 num_predict 截断时自动续写；重复循环或续写达上限即中止。
export async function generateWithContinuation({
  messages,
  signal,
  numPredict = 400,
  maxContinuations = 3,
  onDelta,
}) {
  let text = '';
  let continuations = 0;
  let stoppedBy = 'natural';
  let currentMessages = messages;

  for (let round = 0; round <= maxContinuations; round += 1) {
    let doneReason = 'stop';
    for await (const delta of streamChat({
      messages: currentMessages,
      signal,
      numPredict,
      onDone: ({ doneReason: reason }) => { doneReason = reason; },
    })) {
      text += delta;
      onDelta?.(delta);
    }

    if (doneReason !== 'length') {
      stoppedBy = 'natural';
      break;
    }
    if (isRepetitiveLoop(text)) {
      stoppedBy = 'loop';
      break;
    }
    if (round === maxContinuations) {
      stoppedBy = 'limit';
      break;
    }

    continuations += 1;
    currentMessages = [
      ...messages,
      { role: 'assistant', content: text },
      { role: 'user', content: '请接着上文继续输出剩余部分，不要重复已写内容，不要重新开始。' },
    ];
  }

  return { text, continuations, stoppedBy };
}
