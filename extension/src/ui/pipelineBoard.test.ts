import { strict as assert } from 'assert';
import { formatPipelineBoardGrid } from './pipelineBoard';

describe('formatPipelineBoardGrid', () => {
  it('returns empty string for empty or undefined input', () => {
    assert.equal(formatPipelineBoardGrid([]), '');
    assert.equal(formatPipelineBoardGrid(undefined as any), '');
  });

  it('sorts links alphabetically regardless of input order', () => {
    const links = ['zebra-link', 'apple-link', 'mango-link'];
    const result = formatPipelineBoardGrid(links);
    const lines = result.split('\n').join(' ');
    assert.ok(lines.indexOf('apple-link') < lines.indexOf('mango-link'));
    assert.ok(lines.indexOf('mango-link') < lines.indexOf('zebra-link'));
  });

  it('formats into a grid with max 3 columns', () => {
    const links = ['a', 'b', 'c', 'd', 'e'];
    const result = formatPipelineBoardGrid(links);
    const lines = result.split('\n');
    assert.equal(lines.length, 2);
    assert.equal(lines[0].split(' | ').length, 3);
    assert.equal(lines[1].split(' | ').length, 2);
  });
});
