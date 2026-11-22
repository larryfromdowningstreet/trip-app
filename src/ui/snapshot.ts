// A still copy of the screen, for animations that need the old (or new) look on top of the real app.

/** Copies `from` into `into` (which must already be on the page), including what cloneNode leaves behind. */
export function snapshot(from: HTMLElement, into: HTMLElement): HTMLElement {
  const copy = from.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  // A copied radio button would join the real radio group and untick the real one when added to the page.
  copy.querySelectorAll('[name]').forEach((el) => el.removeAttribute('name'));
  into.append(copy);
  mirror(from, copy);
  return copy;
}

/** Scroll positions, typed text, ticked boxes and canvas pixels (scrolling only works once on the page). */
function mirror(from: HTMLElement, to: HTMLElement) {
  const a = from.querySelectorAll<HTMLElement>('*');
  const b = to.querySelectorAll<HTMLElement>('*');
  a.forEach((el, i) => {
    const twin = b[i];
    if (el.scrollTop || el.scrollLeft) {
      twin.scrollTop = el.scrollTop;
      twin.scrollLeft = el.scrollLeft;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      (twin as typeof el).value = el.value;
      if (el instanceof HTMLInputElement) (twin as HTMLInputElement).checked = el.checked;
    }
    if (el instanceof HTMLCanvasElement) (twin as HTMLCanvasElement).getContext('2d')?.drawImage(el, 0, 0);
  });
}
