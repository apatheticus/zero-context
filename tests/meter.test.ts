import { expect, test } from 'claude-code/testing'

import { COLORS, DEFAULT_KNEES, barRuns, cellZones, colorAt, markerCell, parseZones, riskOf, wordAt } from '../hooks/meter'

const [GREEN, , AMBER, , RED] = COLORS

test('the color follows raw tokens: 30k green, 142k amber, 350k red', async () => {
  expect(colorAt(riskOf(30_000, DEFAULT_KNEES))).toBe(GREEN)
  expect(colorAt(riskOf(142_000, DEFAULT_KNEES))).toBe(AMBER)
  expect(wordAt(riskOf(142_000, DEFAULT_KNEES))).toBe('slipping')
  expect(colorAt(riskOf(350_000, DEFAULT_KNEES))).toBe(RED)
})

test('near the auto-compact line it turns red: 155k of a 167k threshold', async () => {
  expect(colorAt(riskOf(155_000, DEFAULT_KNEES))).not.toBe(RED)
  expect(colorAt(riskOf(155_000, DEFAULT_KNEES, 167_000))).toBe(RED)
})

test('risk never drops as tokens climb', async () => {
  for (const threshold of [undefined, 167_000, 800_000]) {
    let last = -1
    for (let t = 0; t <= 1_000_000; t += 2_500) {
      const r = riskOf(t, DEFAULT_KNEES, threshold)
      expect(r >= last).toBe(true)
      expect(r <= 1).toBe(true)
      last = r
    }
  }
})

test('the marker sits on round(percent × W / 100)', async () => {
  expect(markerCell(14, 40)).toBe(6)
  expect(markerCell(50, 20)).toBe(10)
  expect(markerCell(0, 20)).toBe(0)
  expect(markerCell(100, 20)).toBe(19)
  const runs = barRuns(cellZones(40, 1_000_000, DEFAULT_KNEES), 14)
  const text = runs.map(r => r.text).join('')
  expect(text.length).toBe(40)
  expect(text.indexOf('┃')).toBe(6)
  expect(text.slice(0, 6)).toBe('█'.repeat(6))
  expect(text.slice(7)).toBe('░'.repeat(33))
})

test('the track is fixed: on 1M red starts about 30% along', async () => {
  const zones = cellZones(100, 1_000_000, DEFAULT_KNEES)
  expect(zones.indexOf(4)).toBe(30)
  // On 200k with a 167k threshold the red follows the compact line instead.
  const small = cellZones(100, 200_000, DEFAULT_KNEES, 167_000)
  expect(small.indexOf(4)).toBe(75)
})

test('a bad zones string falls back to the defaults', async () => {
  expect(parseZones('60,120,200,300')).toEqual([...DEFAULT_KNEES])
  expect(parseZones('40,80,160,240')).toEqual([40_000, 80_000, 160_000, 240_000])
  for (const bad of ['', 'abc', '60,120,200', '60,50,200,300', '0,1,2,3', '60,120,200,300,400', undefined]) {
    expect(parseZones(bad)).toEqual([...DEFAULT_KNEES])
  }
})
