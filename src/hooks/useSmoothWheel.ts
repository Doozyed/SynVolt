import { useEffect } from 'react';

/** Smooth mouse-wheel scrolling while leaving editor zoom and Monaco scrolling alone. */
export function useSmoothWheel(): void {
  useEffect(() => {
    const motions = new Map<HTMLElement, { target: number; frame: number }>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onWheel = (event: WheelEvent) => {
      if (reduced.matches || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      let node = event.target instanceof Element ? event.target : null;
      if (node?.closest('.monaco-editor, input, textarea, select, [contenteditable="true"]')) return;
      let element: HTMLElement | null = null;
      while (node && node !== document.documentElement) {
        if (node instanceof HTMLElement) {
          const style = getComputedStyle(node);
          const max = node.scrollHeight - node.clientHeight;
          const position = motions.get(node)?.target ?? node.scrollTop;
          if (max > 1 && /(auto|scroll)/.test(style.overflowY) && ((event.deltaY < 0 && position > 0) || (event.deltaY > 0 && position < max))) { element = node; break; }
        }
        node = node.parentElement;
      }
      if (!element) return;
      event.preventDefault();
      const max = element.scrollHeight - element.clientHeight;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const prior = motions.get(element);
      const target = Math.max(0, Math.min(max, (prior?.target ?? element.scrollTop) + delta));
      if (prior) { prior.target = target; return; }
      const motion = { target, frame: 0 };
      const currentElement = element;
      const step = () => {
        if (!currentElement.isConnected || reduced.matches) { motions.delete(currentElement); return; }
        motion.target = Math.max(0, Math.min(currentElement.scrollHeight - currentElement.clientHeight, motion.target));
        const diff = motion.target - currentElement.scrollTop;
        if (Math.abs(diff) < 2) { currentElement.scrollTop = motion.target; motions.delete(currentElement); return; }
        currentElement.scrollTop += Math.sign(diff) * Math.max(1, Math.abs(diff) * .24);
        motion.frame = requestAnimationFrame(step);
      };
      motions.set(element, motion);
      motion.frame = requestAnimationFrame(step);
    };
    document.addEventListener('wheel', onWheel, { passive: false });
    return () => { document.removeEventListener('wheel', onWheel); motions.forEach(motion => cancelAnimationFrame(motion.frame)); };
  }, []);
}
