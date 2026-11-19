import type { Question } from './types'

const BANK: { id: string; prompt: string; options: string[] }[] = [
  {
    id: 'fear',
    prompt: '对方最怕哪个恶心道具？',
    options: ['臭袜子', '烂番茄', '蟑螂贴纸', '鼻涕泡'],
  },
  {
    id: 'noodle',
    prompt: '选一个面条配料，同时说出口。',
    options: ['香菜', '榴莲', '臭豆腐', '芥末'],
  },
  {
    id: 'rps',
    prompt: '同时出拳！',
    options: ['石头', '剪刀', '布', '举手投降'],
  },
  {
    id: 'breakfast',
    prompt: '对方早餐最可能是？',
    options: ['皮蛋', '臭豆腐脑', '隔夜泡面', '酸黄瓜'],
  },
  {
    id: 'smell',
    prompt: '如果只能闻一个，你们会一起选？',
    options: ['榴莲', '臭豆腐', '蓝纹奶酪', '鲱鱼罐头'],
  },
  {
    id: 'wipe-first',
    prompt: '对方会先擦掉屏幕上的？',
    options: ['蟑螂', '鼻涕', '史莱姆', '臭袜子'],
  },
  {
    id: 'punish-meal',
    prompt: '今晚的惩罚餐是？',
    options: ['螺蛳粉', '臭鳜鱼', '瑞典鲱鱼', '纳豆'],
  },
  {
    id: 'face',
    prompt: '对方的恶心表情更像？',
    options: ['裂开', '变绿', '撤退', '升天'],
  },
  {
    id: 'shout',
    prompt: '一起大喊一句！',
    options: ['好臭！', '没有默契了！', '再来！', '我赢了！'],
  },
  {
    id: 'late',
    prompt: '对方最可能迟到的理由？',
    options: ['在晒袜子', '被史莱姆黏住', '臭到自己了', '在练默契'],
  },
  {
    id: 'snot-color',
    prompt: '选择一种颜色的鼻涕泡。',
    options: ['荧光绿', '芥末黄', '番茄红', '透明'],
  },
  {
    id: 'sleep',
    prompt: '对方睡觉时会？',
    options: ['流口水', '放一小下', '梦话喊好臭', '抱着袜子'],
  },
  {
    id: 'travel',
    prompt: '旅行必带哪样？',
    options: ['除臭喷雾', '湿巾十包', '香菜', '勇气'],
  },
  {
    id: 'roach-react',
    prompt: '看到蟑螂贴纸会？',
    options: ['尖叫', '假装淡定', '拍照发给你', '拖鞋出击'],
  },
  {
    id: 'gesture',
    prompt: '默契手势，同时做！',
    options: ['比心', '比耶', '举手投降', '双手捂鼻'],
  },
  {
    id: 'cant',
    prompt: '对方最受不了的是？',
    options: ['声音', '气味', '黏糊糊', '突然爬过'],
  },
  {
    id: 'slogan',
    prompt: '本轮口号选一个。',
    options: ['越臭越勇', '心灵相通', '今日最臭', '根本擦不完'],
  },
  {
    id: 'aim',
    prompt: '对方会把烂番茄扔向？',
    options: ['屏幕正中', '左上角偷袭', '你的按钮', '不小心砸自己'],
  },
  {
    id: 'cloud',
    prompt: '选择一种云。',
    options: ['放屁云', '乌云', '棉花糖云', '臭袜子云'],
  },
  {
    id: 'lucky',
    prompt: '对方的幸运数字是？',
    options: ['1', '4', '7', '8'],
  },
  {
    id: 'blame',
    prompt: '如果这题没对上，先怪谁？',
    options: ['对方', '自己', '网络', '命运'],
  },
  {
    id: 'movie',
    prompt: '一起选一部假电影。',
    options: ['《臭不可闻》', '《史莱姆之恋》', '《没有默契了》', '《蟑螂总动员》'],
  },
  {
    id: 'wipe-style',
    prompt: '对方擦屏幕的手法是？',
    options: ['疯狂摩擦', '轻轻一点', '用袖子', '喊你帮忙'],
  },
  {
    id: 'boss',
    prompt: '最终 BOSS 道具是？',
    options: ['巨型臭袜子', '史莱姆海啸', '蟑螂军团', '芥末风暴'],
  },
]

export const QUESTIONS: Question[] = BANK.map((q) => ({
  id: q.id,
  prompt: q.prompt,
  options: q.options.map((label, index) => ({ id: `${q.id}-${index}`, label })),
}))

export function questionById(id: string): Question | undefined {
  return QUESTIONS.find((q) => q.id === id)
}
