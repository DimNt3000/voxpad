/**
 * Renders the text as clickable sentences and keeps the highlight in sync.
 *
 * Only the active sentence is ever rebuilt when a word boundary arrives, so the
 * cost per highlight stays constant no matter how long the document is.
 */

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

export class ReaderView {
  /**
   * @param {HTMLElement} root
   * @param {{onSentenceClick?: (index:number) => void, emptyMessage?: string}} options
   */
  constructor(root, { onSentenceClick, emptyMessage = '' } = {}) {
    this.root = root;
    this.spans = [];
    this.chunks = [];
    this.active = -1;
    this.emptyMessage = emptyMessage;

    root.addEventListener('click', (event) => {
      const span = event.target.closest?.('.sentence');
      if (!span || !this.root.contains(span)) return;
      onSentenceClick?.(Number(span.dataset.index));
    });
  }

  setEmptyMessage(message) {
    this.emptyMessage = message;
    if (!this.chunks.length) this.render('', []);
  }

  /** @param {string} text @param {{start:number,end:number,text:string}[]} chunks */
  render(text, chunks) {
    this.chunks = chunks;
    this.spans = [];
    this.active = -1;
    this.root.textContent = '';

    if (!chunks.length) {
      const empty = document.createElement('p');
      empty.className = 'reader__empty';
      empty.textContent = this.emptyMessage;
      this.root.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    chunks.forEach((chunk, index) => {
      if (chunk.start > cursor) {
        // Whitespace between sentences is kept verbatim, so paragraph breaks
        // and indentation survive the round trip.
        fragment.append(document.createTextNode(text.slice(cursor, chunk.start)));
      }
      const span = document.createElement('span');
      span.className = 'sentence';
      span.dataset.index = String(index);
      span.textContent = chunk.text;
      fragment.append(span);
      this.spans.push(span);
      cursor = chunk.end;
    });

    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    this.root.append(fragment);
  }

  setActive(index) {
    if (index === this.active) return;

    const previous = this.active;
    if (previous >= 0 && this.spans[previous]) {
      this.spans[previous].classList.remove('is-active');
      this._resetSpan(previous);
    }

    this.active = index;

    const from = Math.max(0, Math.min(previous < 0 ? 0 : previous, index < 0 ? 0 : index));
    const to = Math.max(previous, index);
    for (let i = from; i <= to && i < this.spans.length; i++) {
      this.spans[i].classList.toggle('is-done', index >= 0 && i < index);
    }

    if (index < 0) return;
    const span = this.spans[index];
    if (!span) return;
    span.classList.add('is-active');
    span.classList.remove('is-done');
    this._scrollIntoView(span);
  }

  /** Wraps one word inside the active sentence. */
  setWord(index, charIndex, charLength) {
    const span = this.spans[index];
    const chunk = this.chunks[index];
    if (!span || !chunk) return;

    const start = Math.max(0, Math.min(charIndex, chunk.text.length));
    const end = Math.min(chunk.text.length, start + charLength);
    if (end <= start) return;

    const mark = document.createElement('span');
    mark.className = 'word';
    mark.textContent = chunk.text.slice(start, end);

    span.textContent = '';
    if (start > 0) span.append(chunk.text.slice(0, start));
    span.append(mark);
    if (end < chunk.text.length) span.append(chunk.text.slice(end));
  }

  clear() {
    this.setActive(-1);
  }

  _resetSpan(index) {
    const span = this.spans[index];
    const chunk = this.chunks[index];
    if (span && chunk && span.childNodes.length > 1) span.textContent = chunk.text;
  }

  _scrollIntoView(span) {
    const container = this.root;
    const containerBox = container.getBoundingClientRect();
    const spanBox = span.getBoundingClientRect();
    const margin = 12;

    const above = spanBox.top < containerBox.top + margin;
    const below = spanBox.bottom > containerBox.bottom - margin;
    if (!above && !below) return;

    const delta = spanBox.top - containerBox.top - (container.clientHeight - spanBox.height) / 2;
    container.scrollTo({
      top: container.scrollTop + delta,
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
    });
  }
}
