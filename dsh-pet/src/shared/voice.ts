import type { PetAnimation } from './settings';

/** 台词类别；canned 语料与模型提示共用同一组类别。 */
export type VoiceKind = 'idle' | 'greet' | 'headpat' | 'feed' | 'cheer' | 'click' | 'wake' | 'sleep' | 'work' | 'success' | 'error';

export const CANNED_LINES: Record<VoiceKind, string[]> = {
  idle: [
    '主人今天也要好好休息哦。',
    '有点无聊，陪我玩一会儿嘛。',
    '写代码别忘了喝水呀。',
    '我在这儿看着你呢。',
    '要不要摸摸我的头？'
  ],
  greet: ['我是{petName}，请多关照。', '主人回来啦，{petName}一直在等你。'],
  headpat: ['唔……被摸头了，好舒服。', '再摸一下下嘛。', '这样会把我摸晕的啦。'],
  feed: ['谢谢主人，真好吃！', '呜哇，是我最喜欢的点心。'],
  cheer: ['主人加油，我在这里陪着你！', '别急别急，慢慢来就好。'],
  click: ['嗯？叫我吗？', '我在我在。', '怎么啦，主人？'],
  wake: ['我醒啦！', '唔……才睡一会儿嘛。'],
  sleep: ['晚安……', '那我先睡一小会儿。'],
  work: ['主人正在忙，我安静一点。', '我在旁边看着你干活。'],
  success: ['这一轮跑完啦，好厉害！', '完成了，主人快去看看吧。'],
  error: ['唔……好像出问题了。', '别灰心，再看看日志吧。']
};

export function cannedLine(kind: VoiceKind, petName: string): string {
  const pool = CANNED_LINES[kind];
  const line = pool[Math.floor(Math.random() * pool.length)];
  return line.replace('{petName}', petName);
}

/** 让模型生成台词时使用的指令；与 canned 语料保持同样的语气基调。 */
export function instructionFor(kind: VoiceKind, petName: string, mood: number): string {
  const style = '只说一到两句中文口语，不超过 40 字，不要引号、不要 emoji、不要解释、不要提自己是 AI。';
  const moodHint = mood >= 80 ? '你现在心情很好。' : mood <= 30 ? '你现在有点低气压，但仍在撒娇。' : '';
  switch (kind) {
    case 'greet':
      return `主人刚打开了 App，用一句自我介绍或问候迎接他。你的名字是${petName}。${moodHint}${style}`;
    case 'headpat':
      return `主人摸了摸你的头，用一句撒娇的回应他。你的名字是${petName}。${moodHint}${style}`;
    case 'feed':
      return `主人喂了你一口点心，用一句开心的回应他。你的名字是${petName}。${moodHint}${style}`;
    case 'cheer':
      return `主人正对着代码发愁，说一句鼓励他的话。你的名字是${petName}。${moodHint}${style}`;
    case 'click':
      return `主人点了你一下，用一句简短的回应他。你的名字是${petName}。${moodHint}${style}`;
    case 'wake':
      return `你刚被主人叫醒，用一句迷迷糊糊的话回应他。${moodHint}${style}`;
    case 'sleep':
      return `主人让你去睡觉，用一句道晚安的话回应他。${moodHint}${style}`;
    case 'work':
      return `主人开始让 AI 干活了，说一句让他安心的话。${style}`;
    case 'success':
      return `主人交给 AI 的任务刚刚成功了，夸他一句。${moodHint}${style}`;
    case 'error':
      return `主人交给 AI 的任务失败了，安慰他一句。${moodHint}${style}`;
    case 'idle':
      return `主人很久没理你了，用一句自言自语式的碎碎念吸引他。你的名字是${petName}。${moodHint}${style}`;
  }
}

/** 交互类动作对应的动画与心情变化，供工具与浮层菜单共用。 */
export interface InteractionSpec {
  kind: Extract<VoiceKind, 'headpat' | 'feed' | 'cheer'>;
  moodDelta: number;
  animation: PetAnimation;
}

export const INTERACTIONS: Record<string, InteractionSpec> = {
  headpat: { kind: 'headpat', moodDelta: 8, animation: 'click' },
  feed: { kind: 'feed', moodDelta: 12, animation: 'action' },
  cheer: { kind: 'cheer', moodDelta: 5, animation: 'say' }
};
