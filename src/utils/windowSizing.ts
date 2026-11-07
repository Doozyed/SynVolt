const DEFAULT_WIDTH = 1339;
const DEFAULT_HEIGHT = 828;
const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;
const SCREEN_MARGIN = 32;

/** Work-area dimensions are in logical pixels, after display scaling. */
export function getInitialWindowSize(workWidth: number, workHeight: number) {
  const widthLimit = Math.max(1, Math.floor(workWidth - SCREEN_MARGIN));
  const heightLimit = Math.max(1, Math.floor(workHeight - SCREEN_MARGIN));
  const scale = Math.min(1, widthLimit / DEFAULT_WIDTH, heightLimit / DEFAULT_HEIGHT);
  return {
    width: Math.min(widthLimit, Math.max(Math.min(MIN_WIDTH, widthLimit), Math.floor(DEFAULT_WIDTH * scale))),
    height: Math.min(heightLimit, Math.max(Math.min(MIN_HEIGHT, heightLimit), Math.floor(DEFAULT_HEIGHT * scale))),
  };
}
