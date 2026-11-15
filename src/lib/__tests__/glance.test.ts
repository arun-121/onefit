/// <reference types="jest" />
import { placeLabels, shadesOf } from '../../components/glance';

// Only the pure helpers are tested here. The animation library needs a phone (even its own mock
// starts the native worklet runtime), so it is replaced by the little that runs when the
// components' files load: making animated components and building an easing curve.
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { createAnimatedComponent: (component: unknown) => component },
  Easing: { bezier: () => (t: number) => t },
  ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
}));

describe('placeLabels (range bar labels)', () => {
  it('centres a label under its mark when there is room', () => {
    expect(placeLabels([150], [60], 300)).toEqual([{ left: 120, lane: 0 }]);
  });

  it('keeps a label inside the bar at either end', () => {
    expect(placeLabels([5, 295], [60, 60], 300)).toEqual([
      { left: 0, lane: 0 },
      { left: 240, lane: 0 },
    ]);
  });

  it('moves a label that would overlap its neighbour to the next lane (over the bar), whatever order the marks come in', () => {
    // A goal at 2,000 and an intake of 1,939 on a 1,800 to 2,800 scale sit a few dp apart.
    const placed = placeLabels([66, 46, 200], [80, 96, 120], 331);
    expect(placed[1]).toEqual({ left: 0, lane: 0 });
    expect(placed[0].lane).toBe(1);
    expect(placed[2].lane).toBe(0);
  });

  it('leaves the spacing between two labels in one lane', () => {
    const [a, b] = placeLabels([50, 120], [60, 60], 300, 12);
    expect(a.lane).toBe(0);
    // 20..80 and 90..150 are 10dp apart, under the 12dp spacing.
    expect(b.lane).toBe(1);
    const [c, d] = placeLabels([50, 125], [60, 60], 300, 12);
    expect([c.lane, d.lane]).toEqual([0, 0]);
  });

  it('never places a label wider than the bar outside it', () => {
    expect(placeLabels([100], [500], 300)).toEqual([{ left: 0, lane: 0 }]);
  });
});

describe('shadesOf', () => {
  it('starts at full strength and gets lighter', () => {
    expect(shadesOf('#6750A4FF', 3)).toEqual(['#6750A4FF', '#6750A4B8', '#6750A480']);
  });
});
