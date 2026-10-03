import type { Key, Mode } from './dsp';

/**
 * 原创生成曲：用「级数」而不是绝对音高记谱，所以能实时移到任何调、在大小调之间切换，
 * 速度也能逐拍连续变化而不失真。Demo 全部使用这些原创曲目（无版权风险）；
 * 接入正式曲库时，换成分轨（stems）+ 实时变速变调即可沿用同一套对拍 / 定调逻辑。
 *
 * 记谱约定（每小节 16 个十六分音符）：
 * - drums：'x' 重击，'o' 轻击，'.' 休止；
 * - bass：相对和弦根音的级数（1 = 根音，5 = 五度，8 = 高八度），null 休止；
 * - arp：和弦内音的序号（0 根音、1 三度、2 五度、3 七度；+4 表示高八度），null 休止；
 * - melody：相对主音的级数（1 = 主音，8 = 高八度主音，负数是低八度），null 休止。
 */

export type Step = number | null;

export interface Song {
  id: string;
  title: string;
  /** 一句话描述，显示在曲目卡片上 */
  vibe: string;
  bpm: number;
  key: Key;
  /** 0–0.3：十六分音符的摇摆程度（lo-fi 的「懒」感） */
  swing: number;
  /** 每小节的和弦级数 */
  chords: number[];
  sevenths: boolean;
  drums: { kick: string; snare: string; hat: string; ohat?: string };
  bass: Step[];
  arp?: Step[];
  /** 每小节一行；行数与 chords 相同 */
  melody: Step[][];
  sound: { pad: 'warm' | 'saw' | 'glass'; lead: 'rhodes' | 'pluck' | 'bell'; bass: 'sub' | 'saw' };
}

const _ = null;

export const SONGS: Song[] = [
  {
    id: 'riverside',
    title: '江边晚风',
    vibe: 'lo-fi · 慢慢走',
    bpm: 84,
    key: { tonic: 5, mode: 'major' }, // F
    swing: 0.18,
    chords: [2, 5, 1, 6],
    sevenths: true,
    drums: {
      kick: 'x.....x...x.....',
      snare: '....x.......x..o',
      hat: 'x.o.x.o.x.o.x.oo',
    },
    bass: [1, _, _, _, _, _, 5, _, 1, _, _, _, _, _, 8, _],
    melody: [
      [3, _, _, 5, _, _, 6, _, 5, _, _, _, 3, _, 2, _],
      [2, _, _, _, 7, _, 6, _, 5, _, _, _, _, _, _, _],
      [3, _, _, 5, _, _, 8, _, 7, _, 6, _, 5, _, _, _],
      [6, _, 5, _, 3, _, _, _, 2, _, _, 1, _, _, _, _],
    ],
    sound: { pad: 'warm', lead: 'rhodes', bass: 'sub' },
  },
  {
    id: 'station',
    title: '下一站',
    vibe: 'house · 通勤',
    bpm: 120,
    key: { tonic: 9, mode: 'minor' }, // A 小调
    swing: 0,
    chords: [1, 6, 3, 7],
    sevenths: false,
    drums: {
      kick: 'x...x...x...x...',
      snare: '....x.......x...',
      hat: '..x...x...x...x.',
      ohat: '......x.......x.',
    },
    bass: [_, _, 1, _, _, _, 8, _, _, _, 1, _, _, _, 8, 5],
    arp: [0, 4, 1, 2, 0, 4, 1, 2, 0, 4, 1, 2, 0, 4, 2, 1],
    melody: [
      [5, _, _, _, _, _, 3, _, _, _, 4, _, 5, _, _, _],
      [6, _, _, _, 5, _, _, _, 3, _, _, _, _, _, _, _],
      [5, _, _, _, _, _, 3, _, _, _, 2, _, 3, _, _, _],
      [2, _, _, _, 1, _, _, _, -2, _, _, _, _, _, _, _],
    ],
    sound: { pad: 'saw', lead: 'pluck', bass: 'saw' },
  },
  {
    id: 'night',
    title: '夜行',
    vibe: 'synthwave · 夜路',
    bpm: 100,
    key: { tonic: 4, mode: 'minor' }, // E 小调
    swing: 0,
    chords: [1, 6, 4, 7],
    sevenths: false,
    drums: {
      kick: 'x.......x.x.....',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
    },
    bass: [1, _, 1, _, 1, _, 1, _, 1, _, 1, _, 1, _, 8, _],
    arp: [0, _, 1, _, 2, _, 4, _, 2, _, 1, _, 0, _, 1, _],
    melody: [
      [8, _, _, _, 7, _, 5, _, _, _, _, _, 3, _, 5, _],
      [6, _, _, _, _, _, 5, _, 3, _, _, _, _, _, _, _],
      [4, _, _, _, 5, _, 6, _, _, _, 5, _, 4, _, 3, _],
      [2, _, _, _, _, _, 5, _, _, _, _, _, _, _, _, _],
    ],
    sound: { pad: 'saw', lead: 'bell', bass: 'saw' },
  },
  {
    id: 'rain',
    title: '雨巷',
    vibe: 'ambient · 发呆',
    bpm: 70,
    key: { tonic: 2, mode: 'major' }, // D
    swing: 0.08,
    chords: [1, 5, 6, 4],
    sevenths: true,
    drums: {
      kick: 'x.........x.....',
      snare: '........o.......',
      hat: '..o...o...o...o.',
    },
    bass: [1, _, _, _, _, _, _, _, 5, _, _, _, _, _, _, _],
    arp: [0, _, _, 2, _, _, 4, _, _, 5, _, _, 6, _, _, _],
    melody: [
      [5, _, _, _, _, _, 6, _, 5, _, _, _, _, _, _, _],
      [5, _, _, _, 4, _, _, _, 2, _, _, _, _, _, _, _],
      [3, _, _, _, _, _, 5, _, 6, _, _, _, 8, _, _, _],
      [6, _, _, _, 5, _, _, _, 4, _, 3, _, _, _, _, _],
    ],
    sound: { pad: 'glass', lead: 'bell', bass: 'sub' },
  },
];

const SCALES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

/** 级数（1 起，可越过 7 或为负）→ 相对主音的半音数 */
export function degreeSemis(degree: number, mode: Mode): number {
  const d = degree - 1;
  const oct = Math.floor(d / 7);
  const idx = ((d % 7) + 7) % 7;
  return SCALES[mode][idx]! + 12 * oct;
}

/** 某个级数上的顺阶和弦（三和弦或七和弦），返回各音相对主音的半音数 */
export function chordSemis(degree: number, mode: Mode, sevenths: boolean): number[] {
  const tones = sevenths ? [0, 2, 4, 6] : [0, 2, 4];
  return tones.map((t) => degreeSemis(degree + t, mode));
}

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
