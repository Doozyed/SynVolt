const SOURCE_PAGE_SIZE = 20;


export async function fetchDisplayPage<T>(
  page: number,
  fetchSourcePage: (page: number) => Promise<{ scripts: T[]; totalPages: number }>,
  maxSourcePages: number,
  displayPageSize = 32,
): Promise<{ scripts: T[]; totalPages: number }> {
  const size = Math.max(1, Math.floor(displayPageSize));
  const offset = (Math.max(1, page) - 1) * size;
  const firstPage = Math.floor(offset / SOURCE_PAGE_SIZE) + 1;
  if (firstPage > maxSourcePages) return { scripts: [], totalPages: Math.ceil(maxSourcePages * SOURCE_PAGE_SIZE / size) };
  const first = await fetchSourcePage(firstPage);
  const sourcePages = Math.min(Math.max(0, first.totalPages), maxSourcePages);
  if (sourcePages === 0) return { scripts: [], totalPages: 0 };
  const lastNeeded = Math.min(sourcePages, Math.ceil((offset + size) / SOURCE_PAGE_SIZE));
  const needed: number[] = [];
  for (let n = firstPage + 1; n <= lastNeeded; n++) needed.push(n);
  // A short final source page determines the exact display page count.
  if (first.totalPages <= maxSourcePages && sourcePages !== firstPage && !needed.includes(sourcePages)) needed.push(sourcePages);
  const extra = await Promise.all(needed.map(async n => [n, await fetchSourcePage(n)] as const));
  const pages = new Map<number, { scripts: T[]; totalPages: number }>([[firstPage, first], ...extra]);
  const last = pages.get(sourcePages);
  const itemCount = first.totalPages > maxSourcePages ? sourcePages * SOURCE_PAGE_SIZE : (sourcePages - 1) * SOURCE_PAGE_SIZE + (last?.scripts.length ?? SOURCE_PAGE_SIZE);
  const scripts: T[] = [];
  for (let n = firstPage; n <= lastNeeded; n++) scripts.push(...(pages.get(n)?.scripts ?? []));
  const start = offset % SOURCE_PAGE_SIZE;
  return { scripts: scripts.slice(start, start + size), totalPages: Math.ceil(itemCount / size) };
}
