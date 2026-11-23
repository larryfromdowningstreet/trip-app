import { describe, expect, it } from 'vitest';
import { aiInstructions, parseBulk, withoutDuplicates } from '../src/core/bulk';

const days = ['2027-03-10', '2027-03-11', '2027-03-12'];

describe('bulk import', () => {
  it('reads what an AI writes, inside a code block with chatter around it', () => {
    const text = `好的，以下是整理結果：
\`\`\`json
{"items":[
  {"date":"2027-03-11","start":"9:05","end":"10:30","type":"sight","title":"清水寺","addressLocal":"京都府京都市東山区清水1丁目294","lat":34.9949,"lng":135.785},
  {"date":"2027-03-11","start":"12:00","type":"用餐","title":"錦市場","note":"午餐","price":"¥3000"},
  {"start":"25:00","title":"晚上散步"}
]}
\`\`\`
希望有幫助！`;
    const r = parseBulk(text, days);
    expect(r.items).toEqual([
      { title: '清水寺', date: '2027-03-11', start: '09:05', end: '10:30', type: 'sight', lat: 34.9949, lng: 135.785, addressLocal: '京都府京都市東山区清水1丁目294' },
      { title: '錦市場', date: '2027-03-11', start: '12:00', type: 'meal', note: '午餐' },
      { title: '晚上散步' },
    ]);
    expect(r.problems).toEqual(['第 3 筆「晚上散步」：看不懂時間「25:00」，略過這個時間']);
  });

  it('reads rows copied from a spreadsheet, with Chinese headings, day numbers and quoted commas', () => {
    const tsv = '第幾天\t時間\t標題\t座標\t備註\n2\t13:30\t清水寺\t34.9949, 135.785\t"人多, 早點去"\n9\t\t\t\t沒有標題';
    const r = parseBulk(tsv, days);
    expect(r.items).toEqual([{ title: '清水寺', date: '2027-03-11', start: '13:30', lat: 34.9949, lng: 135.785, note: '人多, 早點去' }]);
    const csv = '日期,開始,標題,備註\n2027/3/12,08:00,嵐山,"竹林, 小火車"';
    expect(parseBulk(csv, days).items).toEqual([{ title: '嵐山', date: '2027-03-12', start: '08:00', note: '竹林, 小火車' }]);
    expect(parseBulk(tsv, days).problems).toEqual(['第 2 筆：沒有標題，略過', '第 2 筆：看不懂日期「9」，先放在「還沒排日期」']);
  });

  it('flags dates outside the trip, refuses nonsense, and skips what is already there', () => {
    expect(parseBulk('[{"date":"2027-04-01","title":"x"}]', days).problems).toEqual(['第 1 筆「x」：2027-04-01 不在這趟旅程的日期內']);
    expect(parseBulk('隨便寫寫', days).items).toEqual([]);
    expect(parseBulk('{"items": "no"}', days).problems).toHaveLength(1);
    const { fresh, duplicates } = withoutDuplicates(
      [{ title: '清水寺', date: '2027-03-11', start: '13:30' }, { title: '嵐山', date: '2027-03-12' }, { title: '嵐山', date: '2027-03-12' }],
      [{ title: '清水寺', date: '2027-03-11', start: '13:30', note: 'old' }],
    );
    expect(fresh).toEqual([{ title: '嵐山', date: '2027-03-12' }]);
    expect(duplicates).toBe(2);
  });

  it('round-trips: the example in the AI instructions imports cleanly', () => {
    const text = aiInstructions({ name: '京都五日遊', days }, [{ date: '2027-03-10', start: '09:00', title: '機場', note: 'x' }]);
    expect(text).toContain('第 2 天 = 2027-03-11');
    expect(text).toContain('"title":"機場"');
    expect(text).not.toContain('"note":"x"');
    const example = text.split('範例：')[1];
    const r = parseBulk(example.split('我的資料')[0], days);
    expect(r.problems).toEqual([]);
    expect(r.items[0].title).toBe('清水寺');
  });
});
