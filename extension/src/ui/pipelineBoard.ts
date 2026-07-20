export function formatPipelineBoardGrid(links: string[]): string {
  if (!links || links.length === 0) {
    return '';
  }
  
  const sorted = [...links].sort((a, b) => a.localeCompare(b));
  const columns = 3;
  const rows: string[] = [];
  
  for (let i = 0; i < sorted.length; i += columns) {
    const row = sorted.slice(i, i + columns);
    rows.push(row.join(' | '));
  }
  
  return rows.join('\n');
}
