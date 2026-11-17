import type { GenerateParams, Passage, Question } from '../shared/types.js';

const P = [
  `For years, offices treated attention as a switch that could be left on from morning to night. The brain is not built to hold the same level of focus for eight hours. However, research on fatigue tells a different story: the mind works in cycles of roughly ninety minutes, and the quality of work falls before the hours do. What matters is not the length of the day but the rhythm inside it, and teams that ignore that rhythm pay for it in errors that nobody records.`,
  `Managers often measure effort by presence. Yet teams that organise work around focused blocks finish more, and the incentive to protect those blocks is commercial rather than charitable. In practice, a firm that cannot allocate quiet hours loses the best hours of the day to meetings, and the loss is invisible in any report that counts only attendance. The arithmetic is simple: two protected hours produce more than five interrupted ones.`,
  `Critics say short breaks are a luxury. In fact, the evidence points the other way: a five-minute pause away from the screen restores attention, while a glance at email does not. It is not the break itself but what it asks of the mind that decides whether it can sustain attention through the afternoon, when most decisions are made.`,
  `None of this solves congestion on the roads or the cost of office space. But small changes are easier to sustain than a redesign, and firms that adopt them report steadier output and fewer late finishes. A schedule that admits the limits of attention is not a weakness; it is a condition for good work, and it costs almost nothing to try. A short walk, a glass of water, a conversation about something else: the methods are ordinary, and that is the point.`,
  `Resilient organisations plan for tired afternoons instead of pretending they do not exist. Yet resilience here is not a personality trait; it is a timetable. In fact, the firms that recover fastest from a bad week are the ones that already protect a few quiet hours, and the habit survives because it is small enough to keep.`,
];

const TARGETS = ['sustain', 'fatigue', 'incentive', 'allocate', 'congestion', 'resilient'];

function notes(...pairs: [string, string, string][]) {
  return pairs.map(([label, type, note]) => ({ label, type, note }));
}

export function carefulParams(): GenerateParams {
  return {
    type: 'careful_reading',
    difficulty: 'CET4',
    topic: 'work',
    targetWords: TARGETS.map((spell) => ({ spell, cn: '' })),
  };
}

export function carefulFixture(): Passage {
  const questions: Question[] = [
    {
      number: '1',
      type: 'main_idea',
      stem: 'What is the passage mainly about?',
      options: [
        { label: 'A', text: 'Why offices should track the hours staff spend at their desks.' },
        { label: 'B', text: 'Why the working day should follow the rhythm of attention.' },
        { label: 'C', text: 'How companies can reduce the cost of office space.' },
        { label: 'D', text: 'Why short breaks are always enough to restore focus.' },
      ],
      answer: 'B',
      evidence: {
        paraLabel: '1',
        sentence: 'What matters is not the length of the day but the rhythm inside it, and teams that ignore that rhythm pay for it in errors that nobody records.',
      },
      explanation: '全文围绕「按注意力节律安排工作日」展开。',
      distractorNotes: notes(
        ['A', '②', '偷换主体：原文说的是注意力节律，不是统计在座时长'],
        ['C', '③', '未提及：办公室成本只在第四段作为对比出现'],
        ['D', '④', '过于绝对：原文说短暂休息有用，但没说 always 足够'],
      ),
    },
    {
      number: '2',
      type: 'detail',
      stem: 'According to the passage, what happens before the number of working hours falls?',
      options: [
        { label: 'A', text: 'The quality of work begins to drop.' },
        { label: 'B', text: 'Staff ask for shorter days.' },
        { label: 'C', text: 'Managers stop measuring presence.' },
        { label: 'D', text: 'Offices always close earlier.' },
      ],
      answer: 'A',
      evidence: { paraLabel: '1', sentence: 'the mind works in cycles of roughly ninety minutes, and the quality of work falls before the hours do.' },
      explanation: '第一段明确说质量先于时长下降。',
      distractorNotes: notes(
        ['B', '③', '未提及：文中没有员工要求缩短工时的内容'],
        ['C', '②', '半句正确：管理者确实按在座衡量，但不是「停止」'],
        ['D', '④', '过于绝对：always 与原文不符'],
      ),
    },
    {
      number: '3',
      type: 'detail',
      stem: 'What does the passage say a firm loses when it cannot allocate quiet hours?',
      options: [
        { label: 'A', text: 'It loses its best hours to meetings.' },
        { label: 'B', text: 'It loses its commercial incentive.' },
        { label: 'C', text: 'It loses its office space.' },
        { label: 'D', text: 'It loses all of its meetings.' },
      ],
      answer: 'A',
      evidence: { paraLabel: '2', sentence: 'a firm that cannot allocate quiet hours loses the best hours of the day to meetings' },
      explanation: '第二段把「无法拨出安静时段」和「最好时段被会议占掉」直接连起来。',
      distractorNotes: notes(
        ['B', '②', '偷换主体：incentive 是保护专注块的动机，不是被失去的东西'],
        ['C', '③', '未提及'],
        ['D', '④', '过于绝对：原文说的是部分时段，不是全部会议'],
      ),
    },
    {
      number: '4',
      type: 'inference',
      stem: 'What does the passage suggest about a five-minute pause away from the screen?',
      options: [
        { label: 'A', text: 'It restores attention in a way that checking email does not.' },
        { label: 'B', text: 'It is a luxury most firms cannot afford.' },
        { label: 'C', text: 'It works only for staff who work in offices.' },
        { label: 'D', text: 'It must be longer than five minutes to work.' },
      ],
      answer: 'A',
      evidence: { paraLabel: '3', sentence: 'a five-minute pause away from the screen restores attention, while a glance at email does not' },
      explanation: '第三段对比了离开屏幕与看邮件两种「休息」。',
      distractorNotes: notes(
        ['B', '①', '原文明确否定：批评者说这是奢侈，作者用 in fact 反驳'],
        ['C', '③', '未提及：文中没有限定只对办公室员工有效'],
        ['D', '④', '过于绝对：must 与原文相反，五分钟即可'],
      ),
    },
    {
      number: '5',
      type: 'vocabulary',
      stem: 'The word "allocate" in the second paragraph is closest in meaning to',
      options: [
        { label: 'A', text: 'set aside' },
        { label: 'B', text: 'give up' },
        { label: 'C', text: 'take back' },
        { label: 'D', text: 'write down' },
      ],
      answer: 'A',
      evidence: { paraLabel: '2', sentence: 'a firm that cannot allocate quiet hours loses the best hours of the day to meetings' },
      explanation: 'allocate 在这里是「拨出、分配」，与 set aside 最接近。',
      distractorNotes: notes(
        ['B', '①', '原文明确否定：不是放弃，而是分配'],
        ['C', '②', '方向相反：take back 是收回'],
        ['D', '③', '无关：write down 与分配无关'],
      ),
      testedWord: 'allocate',
    },
  ];

  return {
    type: 'careful_reading',
    title: 'The Rhythm of Attention',
    difficulty: 'CET4',
    topic: 'work',
    passage: P.join('\n\n'),
    paragraphs: P.map((text, i) => ({ label: String(i + 1), text })),
    targetWords: TARGETS,
    questions,
    selfCheck: { wordCount: 0 },
  };
}

const MATCH_TARGETS = ['congestion', 'infrastructure', 'subsidy', 'resilient', 'emission'];

export function matchingParams(count = 10): GenerateParams {
  return {
    type: 'paragraph_matching',
    difficulty: 'CET4',
    topic: 'transport',
    targetWords: MATCH_TARGETS.map((spell) => ({ spell, cn: '' })),
  };
}

/** 12 段、10 句、K/L 未被匹配（2 个干扰段） */
export function matchingFixture(paragraphCount = 12, questionCount = 10): Passage {
  const leads = [
    'For most of the last century, planners assumed that traffic would keep growing.',
    'Congestion charging is spreading in cities that once rejected it.',
    'Bus rapid transit moves large numbers of people for a fraction of the cost.',
    'Cycling infrastructure has changed faster than any other part of the network.',
    'Electric buses cut emissions and noise in crowded streets.',
    'Subsidies for low-income riders have moved to the centre of policy.',
    'Resilient networks are designed for the days when something fails.',
    'Freight is the part of the picture that residents notice least.',
    'Public opinion rarely moves in a straight line.',
    'The next decade is likely to be about integration rather than invention.',
    'Parking rules shape how streets are used at the kerbside.',
    'Street lighting consumes a surprising share of a city budget.',
  ];
  const filler = 'People in the office keep asking the same questions about time and work, and the answers rarely change from one month to the next.';
  const labels = 'ABCDEFGHIJKLM'.split('');
  const paragraphs = Array.from({ length: paragraphCount }, (_, i) => ({
    label: labels[i],
    text: `${leads[i % leads.length]} ${filler} ${filler} ${filler}`,
  }));
  const questions: Question[] = Array.from({ length: questionCount }, (_, i) => ({
    number: String(i + 1),
    type: 'detail' as const,
    stem: `Statement ${i + 1} paraphrasing paragraph ${labels[i]}.`,
    answer: labels[i],
    evidence: { paraLabel: labels[i], sentence: leads[i % leads.length] },
    explanation: `第 ${i + 1} 句对应 ${labels[i]} 段。`,
  }));
  return {
    type: 'paragraph_matching',
    title: 'How Cities Move',
    difficulty: 'CET4',
    topic: 'transport',
    passage: '',
    paragraphs,
    targetWords: MATCH_TARGETS,
    questions,
    notes: `本篇有 ${paragraphCount - questionCount} 个段落未被匹配`,
  };
}
