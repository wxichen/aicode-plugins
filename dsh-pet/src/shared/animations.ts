import type { PetAnimation } from '../shared/settings';

export interface AnimationAsset {
  file: string;
  loop: boolean;
}

export const ANIMATION_ASSETS: Record<PetAnimation, AnimationAsset> = {
  idle: { file: 'assets/webm/待机呼吸休闲.webm', loop: true },
  turn: { file: 'assets/webm/东张西望.webm', loop: true },
  click: { file: 'assets/webm/点击回应-开心跃动.webm', loop: false },
  drag: { file: 'assets/webm/被鼠标拖拽悬空反馈.webm', loop: true },
  action: { file: 'assets/webm/原地专心玩魔方.webm', loop: false },
  sleepStart: { file: 'assets/webm/睡觉-开始.webm', loop: false },
  sleepLoop: { file: 'assets/webm/睡觉-循环.webm', loop: true },
  sleepEnd: { file: 'assets/webm/睡觉-起来.webm', loop: false },
  thinking: { file: 'assets/webm/工作状态-思考冒泡.webm', loop: true },
  working: { file: 'assets/webm/工作状态-忙碌点按.webm', loop: true },
  success: { file: 'assets/webm/工作状态-雀跃庆祝.webm', loop: false },
  error: { file: 'assets/webm/工作状态-垂头叹气冒汗.webm', loop: false },
  say: { file: 'assets/webm/碎碎念-对屏碎碎念.webm', loop: true }
};
